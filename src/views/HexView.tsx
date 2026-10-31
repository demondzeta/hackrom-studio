import React, { useEffect, useMemo, useRef, useState } from "react";
import { hex, parseHexBytes } from "../core/bytes";
import { searchPattern } from "../core/analysis";
import { useApp } from "../store";
import { HexInput, NeedRom, Panel } from "../ui/common";
import { LiveButton, writeCmds } from "../live/live";
import { tr } from "../i18n";


const ROWS = 32;

export function HexView() {
  const { rs, version, hex: target, toast, gotoCode } = useApp();
  const [file, setFile] = useState(() => (rs ? Math.max(0, rs.p1) : 0));
  const [top, setTop] = useState(0);
  const [cur, setCur] = useState(0);
  const [nib, setNib] = useState(0);
  const [pattern, setPattern] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [writeHex, setWriteHex] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rs || !target.nonce) return;
    const loc = rs.cpuToFile(target.addr, target.bank);
    if (loc) {
      setFile(loc.file);
      setCur(loc.offset);
      setTop(Math.max(0, (loc.offset & ~15) - 16 * 4));
    }
  }, [target.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = rs?.files[file];
  const matchSet = useMemo(() => new Set(matches.flatMap((m) => Array.from({ length: Math.max(1, pattern.replace(/\s/g, "").length / 2) }, (_, i) => m + i))), [matches, pattern]);

  if (!rs || !f) return <NeedRom />;
  const len = f.data.length;
  void version;

  const setByte = (off: number, v: number) => rs.write(file, off, [v & 0xff], `hex ${f.name}@${hex(off)}`);

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key;
    const move = (d: number) => {
      const n = Math.max(0, Math.min(len - 1, cur + d));
      setCur(n);
      setNib(0);
      if (n < top) setTop(n & ~15);
      if (n >= top + ROWS * 16) setTop((n & ~15) - (ROWS - 1) * 16);
    };
    if (/^[0-9a-fA-F]$/.test(k)) {
      e.preventDefault();
      const v = parseInt(k, 16);
      const old = f.data[cur];
      const nv = nib === 0 ? (v << 4) | (old & 15) : (old & 0xf0) | v;
      setByte(cur, nv);
      if (nib === 0) setNib(1);
      else move(1);
    } else if (k === "ArrowRight") move(1);
    else if (k === "ArrowLeft") move(-1);
    else if (k === "ArrowDown") move(16);
    else if (k === "ArrowUp") move(-16);
    else if (k === "PageDown") move(16 * ROWS);
    else if (k === "PageUp") move(-16 * ROWS);
    else return;
    e.preventDefault();
  };

  const cpu = rs.fileToCpu(file, cur);
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    const off = top + r * 16;
    if (off >= len) break;
    const bytes = [];
    let asc = "";
    for (let i = 0; i < 16; i++) {
      const o = off + i;
      if (o >= len) break;
      const b = f.data[o];
      const mod = b !== f.orig[o];
      bytes.push(
        <span
          key={i}
          className={(o === cur ? "cur " : "") + (mod ? "mod " : "") + (matchSet.has(o) ? "match" : "")}
          onClick={() => {
            setCur(o);
            setNib(0);
            ref.current?.focus();
          }}
        >
          {hex(b, 2)}
        </span>,
      );
      asc += b >= 32 && b < 127 ? String.fromCharCode(b) : ".";
    }
    rows.push(
      <div className="hl" key={off}>
        <span className="ha">{hex(off, 7)}</span>
        <span className="hb">{bytes}</span>
        <span className="hc">{asc}</span>
      </div>,
    );
  }

  return (
    <div className="split" style={{ gridTemplateColumns: "minmax(0,1fr) 340px" }}>
      <Panel
        title={tr("Hex editor")}
        actions={
          <>
            <select value={file} onChange={(e) => { setFile(+e.target.value); setTop(0); setCur(0); setMatches([]); }}>
              {rs.files.map((x, i) => (
                <option key={i} value={i}>
                  {x.name}
                </option>
              ))}
            </select>
            <label className="f">{tr("offset")}{" "}<HexInput value={cur} onChange={(v) => { const n = Math.min(len - 1, v); setCur(n); setTop(Math.max(0, (n & ~15) - 64)); }} width={70} />
            </label>
            <button className="btn sm" onClick={() => setTop((t) => Math.max(0, t - ROWS * 16))}>▲</button>
            <button className="btn sm" onClick={() => setTop((t) => Math.min(len - 16, t + ROWS * 16))}>▼</button>
          </>
        }
      >
        <div
          className="hexgrid"
          tabIndex={0}
          ref={ref}
          onKeyDown={onKey}
          onWheel={(e) => setTop((t) => Math.max(0, Math.min(len - 16, t + Math.sign(e.deltaY) * 16 * 4)))}
          style={{ outline: "none" }}
        >
          {rows}
        </div>
        <p className="muted small">{tr("Click a byte and type hex to overwrite. Arrows/PageUp/PageDown move. Program ROMs are shown in 68k (big-endian) order; export restores the original byte order.")}</p>
      </Panel>
      <div>
        <Panel title={tr("Cursor")}>
          <div className="kv mono small">
            <span>{tr("file offset")}</span>
            <span>${hex(cur, 7)}</span>
            {cpu && (
              <>
                <span>{tr("68k address")}</span>
                <span>
                  <a onClick={() => gotoCode(cpu.addr, Math.max(0, cpu.bank))}>${hex(cpu.addr, 6)}</a>
                  {cpu.bank >= 0 ? ` (bank ${cpu.bank})` : ""}
                </span>
              </>
            )}
            <span>{tr("byte")}</span>
            <span>
              ${hex(f.data[cur], 2)} ({f.data[cur]}) {f.data[cur] !== f.orig[cur] ? <span className="err">{tr("was $")}{hex(f.orig[cur], 2)}</span> : null}
            </span>
            <span>{tr("word")}</span>
            <span>${hex((f.data[cur] << 8) | f.data[cur + 1], 4)}</span>
            <span>{tr("long")}</span>
            <span>${hex(((f.data[cur] << 24) | (f.data[cur + 1] << 16) | (f.data[cur + 2] << 8) | f.data[cur + 3]) >>> 0, 8)}</span>
          </div>
          <h4>{tr("Write bytes here")}</h4>
          <div className="row">
            <input type="text" className="mono" style={{ flex: 1 }} placeholder="4E 71 4E 75" value={writeHex} onChange={(e) => setWriteHex(e.target.value)} />
            <button
              className="btn primary"
              onClick={() => {
                const b = parseHexBytes(writeHex);
                if (!b || !b.length) return toast(tr("Enter hex bytes"), "error");
                try {
                  rs.write(file, cur, b, `write ${b.length} bytes`);
                } catch (e: any) {
                  toast(e.message, "error");
                }
              }}
            >{tr("Write")}</button>
            <LiveButton
              small={false}
              label={tr("Live")}
              cmds={() => {
                const b = parseHexBytes(writeHex);
                if (!b || !cpu) return null;
                return writeCmds(rs, cpu.addr, b, Math.max(0, cpu.bank));
              }}
              title={cpu ? tr("Write these bytes into the running game at this address (temporary)") : tr("Only program ROM addresses can be written live")}
            />
          </div>
        </Panel>
        <Panel title={tr("Search")}>
          <div className="row">
            <input type="text" className="mono" style={{ flex: 1 }} placeholder={tr("4EB9 ???? ????")} value={pattern} onChange={(e) => setPattern(e.target.value)} />
            <button className="btn" onClick={() => setMatches(searchPattern(f.data, pattern, 1, 500))}>{tr("Find")}</button>
          </div>
          <p className="muted small">{tr("Hex bytes, ?? = any byte. Searches the current file.")}</p>
          <div style={{ maxHeight: 280, overflow: "auto" }}>
            <table className="t">
              <tbody>
                {matches.map((m) => (
                  <tr key={m} className="click" onClick={() => { setCur(m); setTop(Math.max(0, (m & ~15) - 64)); }}>
                    <td className="mono">${hex(m, 7)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
