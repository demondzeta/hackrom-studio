import React, { useMemo, useState } from "react";
import { hex, hex6 } from "../core/bytes";
import { findFreeSpace, findMoveLImmToDisp } from "../core/analysis";
import { assemble } from "../core/m68k/asm";
import { routineToAsm } from "../core/relocate";
import { useApp } from "../store";
import { Addr, HexInput, Panel } from "../ui/common";
import { LiveButton, writeCmds } from "../live/live";
import { tr, Tx } from "../i18n";


export const MOVE_TEMPLATE = `; New special move — template based on the KOF97 Oniyaki routine structure.
; Fields of the player object (A4) from the KOF97 notes:
;   ($EF) damage   ($108) score   ($1DE) meter on whiff   ($1E0) meter on hit
;   ($D2/$D4/$D6) ACT numbers used by the move   ($72) ACT to play   ($50) X speed
;   (A4) long = routine to continue with next frame   ($7C) <0 when the ACT finished
; Every call below exists in KOF97; check them in the 68k code view before using
; this on another game.
newmove:
    jsr      $1E2FA              ; special move prologue
    move.b   #$1A,($EF,a4)       ; damage
    move.b   #$05,($108,a4)      ; score
    move.w   #$0C00,($1DE,a4)    ; meter gained on whiff
    move.w   #$0600,($1E0,a4)    ; meter gained on hit
    move.w   #$80,($D2,a4)       ; ACT for this move (pick one in Characters & moves)
    move.l   #$40000,($50,a4)    ; forward speed (16.16)
    btst     #0,($31,a4)         ; facing?
    bne.s    .facing_ok
    neg.l    ($50,a4)
.facing_ok:
    move.w   ($D2,a4),($72,a4)   ; start the animation
    move.w   #$FFFF,($78,a4)
    jsr      $584C               ; animation step
    move.l   #.wait,(a4)         ; continue at .wait next frame
    rts
.wait:
    jsr      $584C               ; advance the animation
    tst.b    ($7C,a4)            ; finished?
    bpl.s    .not_done
    jmp      $1EAD8              ; end of a standing move -> back to neutral
.not_done:
    rts
`;

export function RoutinesPanel() {
  const { rs, profile, version, toast, gotoCode } = useApp();
  const k = profile.kof!;
  const [filter, setFilter] = useState("");
  const [src, setSrc] = useState<string>("");
  const [origin, setOrigin] = useState(0);
  const [title, setTitle] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [repointSite, setRepointSite] = useState<number | null>(null);
  const [cloneStart, setCloneStart] = useState<number | null>(null);

  const sites = useMemo(() => {
    if (!rs?.p1File) return [];
    const p1 = rs.p1File;
    return findMoveLImmToDisp(p1.data.subarray(rs.p1FixedOffset, rs.p1FixedOffset + 0x100000), k.routineField, 0);
  }, [rs, version, k.routineField]);

  const free = useMemo(() => {
    if (!rs?.p1File) return [];
    return findFreeSpace(rs.p1File.data, 256, rs.p1FixedOffset, rs.p1FixedOffset + 0x100000).map((f) => ({ ...f, addr: f.offset - rs.p1FixedOffset }));
  }, [rs, version]);

  if (!rs) return null;
  const result = src ? assemble(src, origin) : null;

  const openClone = (addr: number, site?: number) => {
    const r = routineToAsm(rs.reader(0), addr);
    setSrc(r.source);
    setWarnings(r.warnings);
    setTitle(tr("Clone of {addr} ({n} instructions, {b} bytes)", { addr: hex6(addr), n: r.insns.length, b: r.end - r.start }));
    if (free[0]) setOrigin(free[0].addr);
    setRepointSite(site ?? null);
    setCloneStart(addr);
  };

  const write = () => {
    if (!result || result.errors.length) return toast(tr("Fix the assembly errors first"), "error");
    try {
      const loc = rs.cpuToFile(origin, 0);
      if (!loc) throw new Error(tr("origin is not inside P1"));
      const d = rs.files[loc.file].data;
      for (let i = 0; i < result.bytes.length; i++)
        if (d[loc.offset + i] !== 0xff && d[loc.offset + i] !== 0) {
          if (!confirm(tr("The target area is not empty at ${addr}. Overwrite anyway?", { addr: hex(origin + i) }))) return;
          break;
        }
      rs.writeCpu(origin, result.bytes, 0, `routine at ${hex6(origin)}`);
      toast(tr("{n} bytes written at ${addr}", { n: result.bytes.length, addr: hex(origin, 6) }), "ok");
    } catch (e: any) {
      toast(e.message, "error");
    }
  };

  const repoint = () => {
    if (repointSite === null) return;
    const entry = (cloneStart !== null ? result?.labels["l_" + hex6(cloneStart).toLowerCase()] : undefined) ?? result?.labels["newmove"] ?? origin;
    rs.writeCpu(repointSite + 2, [(entry >>> 24) & 255, (entry >>> 16) & 255, (entry >>> 8) & 255, entry & 255], 0, "repoint move routine");
    toast(tr("The command at {site} now starts the routine at ${addr}", { site: hex6(repointSite), addr: hex(entry, 6) }), "ok");
  };

  const shown = sites.filter((s) => !filter || hex(s.value).includes(filter.toUpperCase()) || hex(s.addr).includes(filter.toUpperCase()));

  return (
    <div className="split wide" style={{ gridTemplateColumns: "360px minmax(0,1fr)" }}>
      <Panel
        title={tr("Move routine assignments ({n})", { n: sites.length })}
        actions={<input type="text" placeholder={tr("filter hex")} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 90 }} />}
        scroll
      >
        <p className="muted small">
          <Tx s="Every `move.l #routine,(${f},An)` in P1. When a command is recognised the character code stores the routine here and jumps to it ($101D8)." vars={{ f: hex(k.routineField) }} />
        </p>
        <table className="t">
          <thead>
            <tr>
              <th>{tr("set at")}</th>
              <th>{tr("routine")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.slice(0, 600).map((s) => (
              <tr key={s.addr}>
                <td>
                  <Addr a={s.addr} />
                </td>
                <td>
                  <Addr a={s.value} />
                </td>
                <td className="row" style={{ gap: 4 }}>
                  <button className="btn sm" onClick={() => openClone(s.value, s.addr)}>{tr("clone")}</button>
                  <LiveButton label="P1" cmds={() => [`trigger 108100 ${hex(s.value, 6)}`]} title={tr("Start this routine on P1 now (the character must own it)")} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div>
        <Panel
          title={title || tr("Routine editor")}
          actions={
            <>
              <button className="btn sm" onClick={() => { setSrc(MOVE_TEMPLATE); setTitle(tr("New move from template")); setWarnings([]); setCloneStart(null); if (free[0]) setOrigin(free[0].addr); }}>{tr("New from template")}</button>
              <label className="f">{tr("assemble at")}{" "}<HexInput value={origin} onChange={setOrigin} width={64} />
              </label>
              <select value="" onChange={(e) => e.target.value && setOrigin(+e.target.value)}>
                <option value="">{tr("free space…")}</option>
                {free.slice(0, 20).map((f) => (
                  <option key={f.addr} value={f.addr}>
                    ${hex(f.addr, 6)} ({f.length}{" "}{tr("bytes)")}</option>
                ))}
              </select>
            </>
          }
        >
          {!src ? (
            <div className="muted">
              <p>{tr("Create new moves by cloning an existing routine (its branches and continuation pointers are turned into labels so it can live anywhere) or by starting from the template.")}</p>
              <ol>
                <li>{tr("Clone the routine of a move that behaves like what you want.")}</li>
                <li>{tr("Change ACT numbers, damage, speeds, sounds.")}</li>
                <li>{tr("Assemble it into free P1 space and write it.")}</li>
                <li>{tr("Repoint an existing command's routine assignment to it — or add a new assignment from a hook.")}</li>
              </ol>
            </div>
          ) : (
            <div className="col">
              {warnings.map((w) => (
                <div key={w} className="notice">
                  {w}
                </div>
              ))}
              <textarea rows={22} value={src} onChange={(e) => setSrc(e.target.value)} spellCheck={false} />
              {result && result.errors.length > 0 && (
                <div className="notice err">
                  {result.errors.slice(0, 8).map((e) => (
                    <div key={e.line}>{tr("line")}{" "}{e.line}: {e.message}
                    </div>
                  ))}
                </div>
              )}
              {result && !result.errors.length && (
                <div className="muted small">
                  {result.bytes.length}{" "}{tr("bytes · $")}{hex(origin, 6)}–${hex(origin + result.bytes.length, 6)}
                </div>
              )}
              <div className="row">
                <button className="btn primary" disabled={!result || !!result.errors.length} onClick={write}>{tr("Assemble & write")}</button>
                {repointSite !== null && (
                  <button className="btn" onClick={repoint} title={tr("Change the move.l immediate at the original assignment so the command runs your new routine")}>{tr("Repoint")}{" "}{hex6(repointSite)}{" "}{tr("to the new routine")}</button>
                )}
                <LiveButton
                  small={false}
                  label={tr("Assemble live + trigger P1")}
                  cmds={() => {
                    if (!result || result.errors.length) return null;
                    const entry = (cloneStart !== null ? result.labels["l_" + hex6(cloneStart).toLowerCase()] : undefined) ?? result.labels["newmove"] ?? origin;
                    return [...writeCmds(rs, origin, result.bytes), `trigger 108100 ${hex(entry, 6)}`];
                  }}
                  title={tr("Put the assembled code into the running game's ROM (temporary) and start it on P1")}
                />
                <button className="btn" onClick={() => gotoCode(origin, 0)}>{tr("View at $")}{hex(origin, 6)}
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
