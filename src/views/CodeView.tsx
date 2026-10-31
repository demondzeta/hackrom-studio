import React, { useEffect, useMemo, useState } from "react";
import { bytesToHex, hex } from "../core/bytes";
import { findMainLoops, xrefsTo } from "../core/analysis";
import { assemble } from "../core/m68k/asm";
import { disasm, Insn } from "../core/m68k/disasm";
import type { RomSet } from "../core/romset";
import { useApp } from "../store";
import { HexInput, NeedRom, Panel } from "../ui/common";
import { LiveButton, writeCmds } from "../live/live";
import { tr } from "../i18n";
import { askText } from "../ui/ask";


let codeCache: { key: string; code: Map<number, Insn> } | null = null;
export function programCode(rs: RomSet, extra: number[] = []) {
  const key = rs.setName + ":" + rs.version + ":" + extra.join(",");
  if (!codeCache || codeCache.key !== key) codeCache = { key, code: findMainLoops(rs, extra).code };
  return codeCache.code;
}

export function CodeView() {
  const { rs, version, code, gotoCode, gotoHex, labelFor, bookmarks, setBookmarks, toast, profile } = useApp();
  const [addr, setAddr] = useState(code.addr);
  const [bank, setBank] = useState(code.bank);
  const [hist, setHist] = useState<number[]>([]);
  const [sel, setSel] = useState<number>(code.addr);
  const [count, setCount] = useState(140);
  const [patch, setPatch] = useState("");
  const [xrefs, setXrefs] = useState<Insn[] | null>(null);

  useEffect(() => {
    if (code.nonce) {
      setHist((h) => [...h.slice(-50), addr]);
      setAddr(code.addr);
      setBank(code.bank);
      setSel(code.addr);
      setXrefs(null);
    }
  }, [code.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const lines = useMemo(() => {
    if (!rs) return [];
    const rd = rs.reader(bank);
    const out: Insn[] = [];
    let a = addr;
    for (let i = 0; i < count; i++) {
      const ins = disasm(rd, a);
      out.push(ins);
      a += ins.size;
    }
    return out;
  }, [rs, addr, bank, count, version]);

  const modified = useMemo(() => {
    const s = new Set<number>();
    if (!rs) return s;
    for (const l of lines) {
      const loc = rs.cpuToFile(l.addr, bank);
      if (!loc) continue;
      const f = rs.files[loc.file];
      for (let i = 0; i < l.size; i++) if (f.data[loc.offset + i] !== f.orig[loc.offset + i]) s.add(l.addr);
    }
    return s;
  }, [rs, lines, bank, version]);

  if (!rs) return <NeedRom />;
  const selIns = lines.find((l) => l.addr === sel) ?? disasm(rs.reader(bank), sel);

  const go = (a: number) => {
    setHist((h) => [...h.slice(-50), addr]);
    setAddr(a & 0xfffffe);
    setSel(a & 0xfffffe);
    setXrefs(null);
  };
  const back = () => {
    const h = [...hist];
    const a = h.pop();
    if (a !== undefined) {
      setAddr(a);
      setSel(a);
      setHist(h);
    }
  };

  const renderOps = (ins: Insn) => {
    const parts = ins.operands.split(/(\$[0-9A-F]+)/);
    return parts.map((p, i) => {
      if (!p.startsWith("$")) return <span key={i}>{p}</span>;
      const v = parseInt(p.slice(1), 16);
      const isCode = v < 0x100000 || (v >= 0x200000 && v < 0x300000);
      const lbl = labelFor(v);
      if (!isCode && !lbl) return <span key={i}>{p}</span>;
      return (
        <a
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            if (isCode) go(v);
          }}
          title={lbl ?? tr("go to")}
        >
          {p}
          {lbl && <span className="c"> {"<" + lbl + ">"}</span>}
        </a>
      );
    });
  };

  const applyPatch = () => {
    const res = assemble(patch, sel);
    if (res.errors.length) return toast(res.errors.map((e) => e.message).join("; "), "error");
    let bytes = Array.from(res.bytes);
    if (bytes.length < selIns.size) while (bytes.length < selIns.size) bytes.push(0x4e, 0x71);
    if (bytes.length > selIns.size && !confirm(tr("New code is {n} bytes but the instruction is {size}. It will overwrite following instructions. Continue?", { n: bytes.length, size: selIns.size }))) return;
    try {
      rs.writeCpu(sel, bytes, bank, `patch ${hex(sel)}: ${patch}`);
      toast(tr("Patched"), "ok");
      setPatch("");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const isBm = bookmarks.some((b) => b.addr === sel);
  const callTargets = lines.filter((l) => l.kind === "call" && l.target !== undefined);

  return (
    <div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
      <Panel
        title={tr("68000 disassembly")}
        actions={
          <>
            <button className="btn sm" disabled={!hist.length} onClick={back} title={tr("Back")}>
              ←
            </button>
            <HexInput value={addr} onChange={go} width={70} />
            {rs.banks.length > 0 && (
              <select value={bank} onChange={(e) => setBank(+e.target.value)} title={tr("Bank mapped at $200000")}>
                {rs.banks.map((_, i) => (
                  <option key={i} value={i}>{tr("bank")}{" "}{i}{" "}{tr("(id")}{" "}{hex(rs.read16(0x200000, i), 4)})
                  </option>
                ))}
              </select>
            )}
            <button className="btn sm" onClick={() => go(Math.max(0, addr - 0x40))}>
              ▲
            </button>
            <button className="btn sm" onClick={() => go(lines[Math.floor(lines.length / 2)].addr)}>
              ▼
            </button>
          </>
        }
      >
        <div className="code">
          {lines.map((l) => {
            const lbl = labelFor(l.addr);
            return (
              <React.Fragment key={l.addr}>
                {lbl && <div className="lbl-line">{lbl}:</div>}
                <div className={"ln" + (l.addr === sel ? " cur" : "") + (modified.has(l.addr) ? " mod" : "")} onClick={() => setSel(l.addr)} onDoubleClick={() => l.target !== undefined && go(l.target)}>
                  <span className="a">{hex(l.addr, 6)}</span>
                  <span className="b">{bytesToHex(rs.readBytes(l.addr, Math.min(l.size, 6), bank), "")}</span>
                  <span className="m">
                    <span className={"mn" + (l.kind === "call" ? " call" : l.kind === "ret" ? " ret" : "")}>{l.mnemonic.padEnd(9)}</span>
                    {renderOps(l)}
                  </span>
                  <span className="c">{l.kind === "call" && l.target !== undefined && labelFor(l.target) ? "" : ""}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" onClick={() => setCount((c) => c + 200)}>{tr("Load more")}</button>
          <span className="muted small">{tr("Double-click a branch/call to follow it. Red bar = modified bytes.")}</span>
        </div>
      </Panel>
      <div>
        <Panel title={`$${hex(sel, 6)}${labelFor(sel) ? " · " + labelFor(sel) : ""}`}>
          <div className="mono" style={{ marginBottom: 6 }}>
            {selIns.text}
          </div>
          <div className="kv small">
            <span>{tr("bytes")}</span>
            <span className="mono">{bytesToHex(rs.readBytes(sel, selIns.size, bank))}</span>
            <span>{tr("file")}</span>
            <span className="mono">
              {(() => {
                const l = rs.cpuToFile(sel, bank);
                return l ? `${rs.files[l.file].name} @ $${hex(l.offset, 6)}` : tr("not in ROM");
              })()}
            </span>
            {selIns.target !== undefined && (
              <>
                <span>{tr("target")}</span>
                <span>
                  <a onClick={() => go(selIns.target!)}>${hex(selIns.target, 6)}</a>
                </span>
              </>
            )}
          </div>
          <h4>{tr("Patch this instruction")}</h4>
          <div className="row">
            <input type="text" className="mono" style={{ flex: 1 }} placeholder={tr("e.g. move.w #$60,($A83A).l   or   nop")} value={patch} onChange={(e) => setPatch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyPatch()} />
            <button className="btn primary" onClick={applyPatch}>{tr("Write")}</button>
            <LiveButton
              small={false}
              label={tr("Live")}
              cmds={() => {
                const r = assemble(patch, sel);
                if (r.errors.length) {
                  toast(r.errors[0].message, "error");
                  return null;
                }
                const b = Array.from(r.bytes);
                while (b.length < selIns.size) b.push(0x4e, 0x71);
                return writeCmds(rs, sel, b, bank);
              }}
              title={tr("Patch the running game only (temporary)")}
            />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button
              className="btn sm"
              onClick={() => {
                const b: number[] = [];
                for (let i = 0; i < selIns.size; i += 2) b.push(0x4e, 0x71);
                rs.writeCpu(sel, b, bank, `nop ${hex(sel)}`);
              }}
            >{tr("NOP it")}</button>
            <button
              className="btn sm"
              onClick={async () => {
                if (isBm) setBookmarks(bookmarks.filter((b) => b.addr !== sel));
                else {
                  const name = await askText(tr("Bookmark name"), labelFor(sel) ?? `sub_${hex(sel, 6)}`);
                  if (name) setBookmarks([...bookmarks, { addr: sel, bank, name }]);
                }
              }}
            >
              {isBm ? "★ Remove bookmark" : "☆ Bookmark / label"}
            </button>
            <button className="btn sm" onClick={() => gotoHex(sel, bank)}>{tr("Hex")}</button>
            <button className="btn sm" onClick={() => setXrefs(xrefsTo(programCode(rs, Object.keys(profile.codeLabels).map(Number)), sel))}>{tr("Find references")}</button>
          </div>
          {xrefs && (
            <>
              <h4>{tr("References to $")}{hex(sel, 6)}</h4>
              {xrefs.length === 0 ? (
                <p className="muted small">{tr("None found in traced code (code reached only through tables may be missed).")}</p>
              ) : (
                <table className="t">
                  <tbody>
                    {xrefs.map((x) => (
                      <tr key={x.addr} className="click" onClick={() => go(x.addr)}>
                        <td className="mono">{hex(x.addr, 6)}</td>
                        <td className="mono">{x.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Panel>
        <Panel title={tr("Calls on this page")}>
          <table className="t">
            <tbody>
              {[...new Set(callTargets.map((c) => c.target!))].slice(0, 40).map((t) => (
                <tr key={t} className="click" onClick={() => go(t)}>
                  <td className="mono">{hex(t, 6)}</td>
                  <td>{labelFor(t) ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title={tr("Bookmarks & labels")} scroll>
          <table className="t">
            <tbody>
              {[...bookmarks.map((b) => ({ ...b, user: true })), ...Object.entries(profile.codeLabels).map(([a, n]) => ({ addr: +a, bank: 0, name: n, user: false }))]
                .sort((a, b) => a.addr - b.addr)
                .map((b) => (
                  <tr key={b.addr + b.name} className="click" onClick={() => gotoCode(b.addr, b.bank)}>
                    <td className="mono">{hex(b.addr, 6)}</td>
                    <td>
                      {b.user ? "★ " : ""}
                      {b.name}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </div>
  );
}
