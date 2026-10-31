import React, { useMemo, useState } from "react";
import { hex } from "../core/bytes";
import { CommandDef, commandSlots, commandTableFor, COMPARE_MODES, inputToArrows, inputToText, scanCommandTables, serializeCommand } from "../games/kofEngine";
import { useApp } from "../store";
import { Addr, HexInput, Panel } from "../ui/common";
import { LiveButton, writeCmds } from "../live/live";
import { tr } from "../i18n";


const DIRS: [string, number][] = [
  ["·", 0], ["↑", 1], ["↓", 2], ["←", 4], ["→", 8], ["↖", 5], ["↗", 9], ["↙", 6], ["↘", 0xa],
];

export function CommandsPanel() {
  const { rs, profile, version, toast } = useApp();
  const k = profile.kof!;
  const [tables, setTables] = useState<number[] | null>(null);
  const [table, setTable] = useState<number | null>(null);
  const [slot, setSlot] = useState(0);
  const [draft, setDraft] = useState<CommandDef | null>(null);

  const entries = useMemo(() => {
    if (!rs || table === null) return [];
    return commandSlots(rs, table).map((e) => ({ i: e.slot, ptr: e.ptr, def: e.def }));
  }, [rs, table, version]);
  const perChar = !!(rs && k.commandPtrTable !== undefined);

  if (!rs) return null;
  const area = k.commandArea;
  const sel = entries[slot];
  const def = draft ?? sel?.def ?? null;

  const scan = () => {
    if (!area) return toast(tr("No command area defined for this profile"), "error");
    const t = scanCommandTables(rs, area);
    setTables(t);
    if (t.length) setTable(t[0]);
  };

  const write = () => {
    if (!draft || !sel) return;
    const bytes = serializeCommand(draft);
    if (bytes.length !== sel.def.size) return toast(tr("Step count changed: the definition must keep the same size (or repoint the slot to a new definition)"), "error");
    rs.writeCpu(sel.ptr, bytes, 0, `command ${hex(sel.ptr)}`);
    setDraft(null);
    toast(tr("Command written"), "ok");
  };

  const setStep = (i: number, patch: Partial<{ mode: number; input: number }>) => {
    if (!def) return;
    const steps = def.steps.map((s, k2) => (k2 === i ? { ...s, ...patch } : s));
    setDraft({ ...def, steps });
  };

  return (
    <div className="split3" style={{ gridTemplateColumns: "220px minmax(0,1fr) 380px" }}>
      <Panel title={perChar ? "Characters" : "Check tables"} actions={perChar ? undefined : <button className="btn sm" onClick={scan}>{tr("Scan")}</button>} scroll>
        {perChar ? (
          <table className="t">
            <tbody>
              {profile.characters.slice(0, 32).map((name, ch) => {
                const r = commandTableFor(rs, k, ch, 1), l = commandTableFor(rs, k, ch, 0);
                return (
                  <tr key={ch} className={r === table || l === table ? "sel" : ""}>
                    <td className="mono muted">{hex(ch, 2)}</td>
                    <td>{name}</td>
                    <td>
                      {r !== null && (
                        <button className="btn sm" onClick={() => { setTable(r); setSlot(0); setDraft(null); }} title={tr("facing right: ${a}", { a: hex(r, 6) })}>
                          →
                        </button>
                      )}{" "}
                      {l !== null && (
                        <button className="btn sm" onClick={() => { setTable(l); setSlot(0); setDraft(null); }} title={tr("facing left: ${a}", { a: hex(l, 6) })}>
                          ←
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : !tables ? (
          <p className="muted">{tr("Each character has tables of 16 pointers to motion definitions (one per facing). The parser at")}{" "}<Addr a={0x12914} />{" "}{tr("walks them every frame.")}{area && (
              <>
                {" "}{tr("Scans $")}{hex(area[0])}–${hex(area[1])}.
              </>
            )}
          </p>
        ) : (
          <table className="t">
            <tbody>
              {tables.map((t, i) => (
                <tr key={t} className={"click" + (t === table ? " sel" : "")} onClick={() => { setTable(t); setDraft(null); }}>
                  <td className="mono">{i}</td>
                  <td className="mono">${hex(t, 6)}</td>
                  <td className="small muted">{t === 0xa6e38 ? "Kyo (documented)" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 8 }}>
          <label className="f small">{tr("open table")}{" "}<HexInput value={table ?? 0xa6e38} onChange={(v) => { setTable(v); setDraft(null); }} width={64} />
          </label>
        </div>
      </Panel>
      <Panel title={table !== null ? `Table $${hex(table, 6)}` : "Table"}>
        {table === null ? (
          <p className="muted">{tr("Scan or enter a table address (Kyo's is $A6E38 in KOF97).")}</p>
        ) : (
          <table className="t">
            <thead>
              <tr>
                <th>#</th>
                <th>{tr("pointer")}</th>
                <th>{tr("motion")}</th>
                <th>{tr("window")}</th>
                <th>{tr("charge")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.i} className={"click" + (e.i === slot ? " sel" : "")} onClick={() => { setSlot(e.i); setDraft(null); }}>
                  <td className="mono">{e.i}</td>
                  <td className="mono">${hex(e.ptr, 6)}</td>
                  <td>{e.def.empty ? <span className="muted">{tr("empty")}</span> : <span className="motion">{e.def.steps.map((s) => inputToArrows(s.input)).join(" ")}</span>}</td>
                  <td className="mono">{e.def.empty ? "" : e.def.window}</td>
                  <td className="mono">{e.def.empty ? "" : e.def.charge}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">{tr("Inputs are written facing right in the right-facing table (← = back). Buttons: A/B/C/D, “any” = any button. The recognised slot sets a bit in the result at $10DA48 which the character code turns into a move.")}</p>
      </Panel>
      <Panel title={sel ? `Definition @ $${hex(sel.ptr, 6)}` : "Definition"}>
        {!def || !sel ? (
          <p className="muted">{tr("Pick a slot.")}</p>
        ) : def.empty ? (
          <p className="muted">{tr("Empty slot (FF 00). Repoint it to a new definition to add a motion.")}</p>
        ) : (
          <div className="col">
            <div className="motion">{def.steps.map((s) => inputToArrows(s.input)).join("  ")}</div>
            <label className="f">{tr("input window (frames)")}{" "}<input type="number" className="num" value={def.window} onChange={(e) => setDraft({ ...def, window: +e.target.value & 0xff })} />
            </label>
            <label className="f">{tr("charge time")}{" "}<input type="number" className="num" value={def.charge} onChange={(e) => setDraft({ ...def, charge: +e.target.value & 0xffff })} />
            </label>
            <table className="t">
              <thead>
                <tr>
                  <th>{tr("step")}</th>
                  <th>{tr("direction")}</th>
                  <th>{tr("buttons")}</th>
                  <th>{tr("compare")}</th>
                </tr>
              </thead>
              <tbody>
                {def.steps.map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}</td>
                    <td>
                      <select value={s.input & 0x0f} onChange={(e) => setStep(i, { input: (s.input & 0xf0) | +e.target.value })}>
                        {DIRS.map(([n, v]) => (
                          <option key={v} value={v}>
                            {n}
                          </option>
                        ))}
                        {!DIRS.some(([, v]) => v === (s.input & 15)) && <option value={s.input & 15}>{hex(s.input & 15)}</option>}
                      </select>
                    </td>
                    <td>
                      {["A", "B", "C", "D"].map((b, bi) => (
                        <label key={b} className="f small" style={{ marginRight: 4 }}>
                          <input type="checkbox" checked={!!(s.input & (0x10 << bi))} onChange={(e) => setStep(i, { input: e.target.checked ? s.input | (0x10 << bi) : s.input & ~(0x10 << bi) })} />
                          {b}
                        </label>
                      ))}
                    </td>
                    <td>
                      <select value={s.mode} onChange={(e) => setStep(i, { mode: +e.target.value })}>
                        {Object.entries(COMPARE_MODES).map(([v, n]) => (
                          <option key={v} value={+v}>
                            {hex(+v, 2)} {tr(n)}
                          </option>
                        ))}
                        {!(s.mode in COMPARE_MODES) && <option value={s.mode}>{hex(s.mode, 2)}</option>}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mono small muted">{tr("bytes:")}{" "}{serializeCommand(def).map((b) => hex(b, 2)).join(" ")} · {def.steps.map((s) => inputToText(s.input)).join(" ")}
            </div>
            <div className="row">
              <button className="btn primary" disabled={!draft} onClick={write}>{tr("Write to ROM")}</button>
              <button className="btn" disabled={!draft} onClick={() => setDraft(null)}>{tr("Revert")}</button>
              <LiveButton small={false} label={tr("Try live")} cmds={() => (draft && sel && serializeCommand(draft).length === sel.def.size ? writeCmds(rs, sel.ptr, serializeCommand(draft)) : null)} title={tr("Use this input in the running game right away (temporary)")} />
            </div>
            <p className="muted small">{tr("Tip from the notes: changing a step's compare mode from 14 to 04 makes the motion more lenient (diagonals accepted). Shorter windows make a motion harder.")}</p>
          </div>
        )}
        {sel && (
          <div style={{ marginTop: 10 }}>
            <label className="f small">{tr("repoint slot")}{" "}{slot}{" "}{tr("to")}<HexInput
                value={sel.ptr}
                width={64}
                onChange={(v) => {
                  rs.writeCpu(table! + slot * 4, [0, (v >> 16) & 255, (v >> 8) & 255, v & 255], 0, "repoint command");
                  toast(tr("Slot {slot} now uses ${addr}", { slot, addr: hex(v, 6) }), "ok");
                }}
              />
            </label>
          </div>
        )}
      </Panel>
    </div>
  );
}
