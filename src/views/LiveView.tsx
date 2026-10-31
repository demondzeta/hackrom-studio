import React, { useEffect, useMemo, useState } from "react";
import { hex } from "../core/bytes";
import { cPairs, locateCTile } from "../core/gfx";
import { analyzeMoves, buttonsText, commandSlots, commandTableFor, decodeSpriteDef, imageTableFor, inputToArrows, kofBanks, MoveEntry, p1ActMap } from "../games/kofEngine";
import { TM_BOX_COLORS, tmBoxKind } from "../games/profiles";
import { LivePlayer, romDiffCmds, useLive } from "../live/live";
import { useApp } from "../store";
import { blockPixels } from "../ui/sprite";
import { HexInput, NeedRom, Panel, useActivePalette, useRgba } from "../ui/common";
import { tr, Tx } from "../i18n";
import { InjectorPanel } from "./InjectorPanel";
import { isDesktop } from "../ui/DesktopUpdates";

const OBJ = { P1: 0x108100, P2: 0x108300 };

export function LiveSetup() {
  const { enabled, setEnabled, connected, bridge, dir, state } = useLive();
  return (
    <Panel
      title={tr("Emulator link")}
      actions={
        <label className="f">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}{tr("enabled")}</label>
      }
    >
      <div className="row" style={{ marginBottom: 8 }}>
        <span className={"tag " + (connected ? "documented" : "experimental")}>{connected ? tr("connected · frame {f} · {rom}", { f: state?.frame ?? 0, rom: state?.rom ?? "" }) : enabled ? (bridge ? tr("waiting for FBNeo…") : tr("dev server bridge not found")) : tr("off")}</span>
      </div>
      {!connected && (
        <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {!isDesktop && <li><Tx s="Run the app with `npm run dev` (the link uses the dev server)." /></li>}
          <li>
            <Tx s="Start the game in FBNeo (Fightcade's FBNeo works: open it from Fightcade's test game or run `fcadefbneo.exe kof97`)." />
          </li>
          <li>
            <Tx s="In FBNeo: **Game → Lua Scripting → New Lua Script Window → Browse**, pick `{path}`, press **Run**." vars={{ path: dir || "app\\tools\\live\\hackrom_live.lua" }} />
          </li>
          <li>{tr("Tick “enabled”. Everything you do from here is temporary: reset or close the game and it is gone.")}</li>
        </ol>
      )}
      {connected && state?.err && <div className="notice err small">{tr("Lua:")}{" "}{state.err}</div>}
    </Panel>
  );
}

function decodeLiveFrame(rs: ReturnType<typeof useApp>["rs"], k: NonNullable<ReturnType<typeof useApp>["profile"]["kof"]>, p: LivePlayer) {
  if (!rs) return null;
  const banks = kofBanks(rs, k);
  if (!banks) return null;
  const tableBase = rs.read32(k.charTable + p.ch * 4, banks.graphBank) & 0xffffff;
  const off = p.graph - tableBase;
  if (off < 0 || off % 6) return null;
  const frameId = off / 6;
  const image = rs.read16(p.graph + 4, banks.graphBank);
  const gx = (rs.read16(p.graph, banks.graphBank) << 16) >> 16, gy = (rs.read16(p.graph + 2, banks.graphBank) << 16) >> 16;
  const it = imageTableFor(rs, k, banks.imageBank, p.ch);
  if (it === undefined) return null;
  const defAddr = rs.read32(it + image * 4, banks.imageBank) & 0xffffff;
  const def = decodeSpriteDef(rs, banks.imageBank, defAddr, "masked");
  return { frameId, image, defAddr, def, gx, gy, banks };
}

function PlayerCard({ name, p, moves }: { name: "P1" | "P2"; p: LivePlayer; moves: MoveEntry[] }) {
  const { rs, profile, gotoTile, gotoCode } = useApp();
  const { send } = useLive();
  const k = profile.kof!;
  const pal = useActivePalette();
  const rgba = useRgba(pal);
  const pairs = useMemo(() => (rs ? cPairs(rs) : []), [rs]);
  const p2act = rs ? p1ActMap(rs, k, p.ch)[p.act] : undefined;
  const fr = decodeLiveFrame(rs, k, p);
  const moveOf = (r: number) => moves.find((m) => m.routine === r);
  const cur = moveOf(p.routine);
  const facingRight = !!(p.facing & 1);

  const draw = (c: HTMLCanvasElement | null) => {
    if (!c || !rs) return;
    const S = 2, W = 220, H = 200, OX = 110, OY = 180;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, W * S, H * S);
    ctx.imageSmoothingEnabled = false;
    ctx.strokeStyle = "#3a4260";
    ctx.beginPath();
    ctx.moveTo(0, OY * S);
    ctx.lineTo(W * S, OY * S);
    ctx.moveTo(OX * S, 0);
    ctx.lineTo(OX * S, H * S);
    ctx.stroke();
    if (fr) {
      const w = fr.def.cols * 16, h = fr.def.rows * 16;
      const px = blockPixels(rs, pairs, fr.def.cells, fr.def.cols, fr.def.rows);
      const off = document.createElement("canvas");
      off.width = w;
      off.height = h;
      const o = off.getContext("2d")!;
      const img = o.createImageData(w, h);
      for (let i = 0; i < px.length; i++) {
        const col = rgba[px[i]];
        if (col && col[3]) img.data.set([col[0], col[1], col[2], 255], i * 4);
      }
      o.putImageData(img, 0, 0);
      ctx.save();
      if (facingRight) {
        ctx.translate(OX * S, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(off, fr.gx * S, (OY + fr.gy) * S, w * S, h * S);
      } else ctx.drawImage(off, (OX + fr.gx) * S, (OY + fr.gy) * S, w * S, h * S);
      ctx.restore();
    }
    p.boxes.slice(0, 4).forEach((b, slot) => {
      if (!(p.status & (1 << slot)) || (!b.w && !b.h)) return;
      const color = TM_BOX_COLORS[tmBoxKind(b.id << 2)];
      const cx = OX + (facingRight ? -b.x : b.x), cy = OY + b.y;
      ctx.strokeStyle = color;
      ctx.fillStyle = color + "40";
      ctx.lineWidth = 2;
      ctx.fillRect((cx - b.w) * S, (cy - b.h) * S, b.w * 2 * S, b.h * 2 * S);
      ctx.strokeRect((cx - b.w) * S, (cy - b.h) * S, b.w * 2 * S, b.h * 2 * S);
    });
  };

  const tiles = fr ? fr.def.cells.filter((t) => t >= 0) : [];
  const hpPct = Math.min(100, Math.round((p.hp / 0x67) * 100));

  return (
    <Panel title={`${name} · ${profile.characters[p.ch] ?? "char " + hex(p.ch, 2)}`}>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <canvas ref={draw} width={440} height={400} className="checker" style={{ width: 220, height: 200, borderRadius: 8 }} />
        <div className="kv small" style={{ flex: 1, minWidth: 220 }}>
          <span>{tr("HP")}</span>
          <span>
            <span style={{ display: "inline-block", width: 120, height: 8, background: "#2a3043", borderRadius: 4, verticalAlign: "middle" }}>
              <span style={{ display: "block", width: `${hpPct}%`, height: 8, background: "#3ccf7a", borderRadius: 4 }} />
            </span>{" "}
            {tr("${hp} · power {p}", { hp: hex(p.hp, 2), p: p.power })}
          </span>
          <span>{tr("ACT")}</span>
          <span className="mono">{tr("P1 code $")}{hex(p.act, 3)}
            {p2act !== undefined && p2act !== p.act ? ` → P2 ACT $${hex(p2act, 3)}` : ""}{" "}{tr("· frame {n}", { n: p.frameIdx })}
          </span>
          <span>{tr("move routine")}</span>
          <span className="mono">
            <a onClick={() => gotoCode(p.routine, 0)}>${hex(p.routine, 6)}</a> {cur ? `(${tr(cur.context)} ${cur.slot !== null ? tr("slot") + " " + cur.slot : tr("command normal")})` : ""}
          </span>
          <span>{tr("next routine")}</span>
          <span className="mono">
            <a onClick={() => gotoCode(p.next, 0)}>${hex(p.next, 6)}</a>
          </span>
          <span>{tr("position")}</span>
          <span className="mono">
            {tr("x {x} y {y} · facing {dir}", { x: p.x, y: p.y, dir: tr(facingRight ? "right" : "left") })}
          </span>
          {fr && (
            <>
              <span>{tr("image")}</span>
              <span className="mono">{tr("frame id ${f} → image ${i} → def ${d} ({c}×{r}, first tile ${t})", { f: hex(fr.frameId, 4), i: hex(fr.image, 4), d: hex(fr.defAddr, 6), c: fr.def.cols, r: fr.def.rows, t: hex(fr.def.baseTile, 5) })}
              </span>
            </>
          )}
        </div>
      </div>
      {fr && (
        <details style={{ marginTop: 8 }}>
          <summary className="small">{tr("Tiles on screen now ({n}) — click to open in Sprite tiles", { n: tiles.length })}</summary>
          <div className="mono small" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, maxHeight: 140, overflow: "auto" }}>
            {tiles.map((t) => {
              const loc = locateCTile(pairs, t);
              return (
                <a key={t} className="pill" onClick={() => gotoTile(t)} title={loc && rs ? `${rs.files[loc.pair.odd].name} @ $${hex(loc.offset, 6)} / ${rs.files[loc.pair.even].name}` : ""}>
                  ${hex(t, 5)}
                  {loc && rs ? ` · ${rs.files[loc.pair.odd].name.replace(/^.*\./, "")}@${hex(loc.offset, 6)}` : ""}
                </a>
              );
            })}
          </div>
        </details>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm" onClick={() => send([`freeze 1 ${hex(OBJ[name] + 0x139, 6)} 67`])}>{tr("Freeze HP full")}</button>
        <button className="btn sm" onClick={() => send([`unfreeze ${hex(OBJ[name] + 0x139, 6)}`])}>{tr("Unfreeze HP")}</button>
        <button className="btn sm" onClick={() => send([`w8 ${hex(OBJ[name] + 0x1e3, 6)} 3`])}>{tr("3 power stocks")}</button>
      </div>
    </Panel>
  );
}

function MoveTrigger({ who, ch, moves }: { who: "P1" | "P2"; ch: number; moves: MoveEntry[] }) {
  const { rs, profile, gotoCode } = useApp();
  const { send, connected } = useLive();
  const k = profile.kof!;
  const slots = useMemo(() => {
    if (!rs) return [];
    const t = commandTableFor(rs, k, ch, 1);
    return t ? commandSlots(rs, t) : [];
  }, [rs, k, ch]);
  return (
    <Panel title={tr("{who} moves · {name} (complete moves = routines)", { who, name: profile.characters[ch] })} scroll>
      <table className="t">
        <thead>
          <tr>
            <th>{tr("where")}</th>
            <th>{tr("input")}</th>
            <th>{tr("routine")}</th>
            <th>{tr("ACTs it plays")}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {moves.map((m) => (
            <tr key={m.site}>
              <td className="small">{tr(m.context)}</td>
              <td className="motion" style={{ fontSize: 14 }}>
                {m.slot !== null && slots[m.slot] ? slots[m.slot].def.steps.map((s) => inputToArrows(s.input)).join(" ") : <span className="small muted">{tr(m.kind)}</span>}
                <span className="small muted"> {buttonsText(m.buttons)}</span>
              </td>
              <td className="mono">
                <a onClick={() => gotoCode(m.routine, 0)}>${hex(m.routine, 6)}</a>
              </td>
              <td className="mono small">{m.acts.slice(0, 10).map((a) => hex(a, 2)).join(" ")}</td>
              <td>
                <button className="btn sm primary" disabled={!connected} onClick={() => send([`trigger ${hex(OBJ[who], 6)} ${hex(m.routine, 6)}`])} title={tr("Start this move now on the running game")}>{tr("▶ trigger")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">{tr("Trigger writes the routine into the player object (+$198 and +0), exactly what the command handler does after a motion. Supers need power stocks.")}</p>
    </Panel>
  );
}

function RamPanel() {
  const { profile } = useApp();
  const { state, send, connected } = useLive();
  const [custom, setCustom] = useState<{ addr: number; name: string }[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("nghs.liveWatch") ?? "[]");
    } catch {
      return [];
    }
  });
  const [addr, setAddr] = useState(0x108172);
  const rows = useMemo(() => [...profile.ram.filter((r) => r.addr < 0x110000).map((r) => ({ addr: r.addr, name: r.name })), ...custom], [profile, custom]);

  useEffect(() => {
    if (!connected) return;
    send(["clearwatch", ...rows.map((r) => `watch ${hex(r.addr, 6)} 4`)]);
  }, [connected, rows, send]);

  const save = (c: typeof custom) => {
    setCustom(c);
    try {
      localStorage.setItem("nghs.liveWatch", JSON.stringify(c));
    } catch {
      /* ignore */
    }
  };

  return (
    <Panel
      title={tr("RAM: watch, edit, freeze")}
      actions={
        <>
          <HexInput value={addr} onChange={setAddr} width={64} />
          <button className="btn sm" onClick={() => save([...custom, { addr, name: "custom" }])}>{tr("+ watch")}</button>
          <button className="btn sm" onClick={() => send(["unfreezeall"])}>{tr("Unfreeze all")}</button>
        </>
      }
      scroll
    >
      <table className="t">
        <thead>
          <tr>
            <th>{tr("address")}</th>
            <th>{tr("name")}</th>
            <th>{tr("bytes now")}</th>
            <th>{tr("write byte / word")}</th>
            <th>{tr("freeze")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const b = state?.watches[r.addr];
            const frozen = state?.freezes.find((f) => f.addr === r.addr);
            return (
              <tr key={r.addr + "_" + i}>
                <td className="mono">${hex(r.addr, 6)}</td>
                <td className="small">{tr(r.name)}</td>
                <td className="mono">{b ? Array.from(b, (x) => hex(x, 2)).join(" ") : "—"}</td>
                <td>
                  <WriteCell addr={r.addr} send={send} />
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={!!frozen}
                    onChange={(e) => {
                      const v = b ? b[0] : 0;
                      send([e.target.checked ? `freeze 1 ${hex(r.addr, 6)} ${hex(v, 2)}` : `unfreeze ${hex(r.addr, 6)}`]);
                    }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

function WriteCell({ addr, send }: { addr: number; send: (c: string[]) => Promise<boolean> }) {
  const [v, setV] = useState("");
  return (
    <span className="row" style={{ gap: 4 }}>
      <input type="text" className="mono" style={{ width: 70 }} placeholder={tr("hex")} value={v} onChange={(e) => setV(e.target.value)} />
      <button
        className="btn sm"
        onClick={() => {
          const t = v.replace(/[^0-9a-f]/gi, "");
          if (!t) return;
          send([t.length <= 2 ? `w8 ${hex(addr, 6)} ${t}` : t.length <= 4 ? `w16 ${hex(addr, 6)} ${t}` : `w32 ${hex(addr, 6)} ${t}`]);
        }}
      >{tr("write")}</button>
    </span>
  );
}

export function LiveView() {
  const { rs, profile, toast } = useApp();
  const { state, connected, send } = useLive();
  const [overlay, setOverlay] = useState(false);
  const k = profile.kof;
  const p1Moves = useMemo(() => (rs && k && state?.p1 ? analyzeMoves(rs, k, state.p1.ch) : []), [rs, k, state?.p1?.ch]); // eslint-disable-line react-hooks/exhaustive-deps
  const p2Moves = useMemo(() => (rs && k && state?.p2 ? analyzeMoves(rs, k, state.p2.ch) : []), [rs, k, state?.p2?.ch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rs) return <NeedRom />;
  const diff = romDiffCmds(rs);
  const label = (r: number) => {
    const m = [...p1Moves, ...p2Moves].find((x) => x.routine === r);
    return m ? `${tr(m.context)}${m.slot !== null ? " " + tr("slot") + " " + m.slot : ""} (${m.acts.slice(0, 3).map((a) => hex(a, 2)).join(",")})` : "";
  };

  return (
    <div className="col">
      <div className="grid2">
        <LiveSetup />
        <Panel title={tr("Temporary edits & tools")}>
          <div className="col">
            <div className="row">
              <button
                className="btn primary"
                disabled={!connected || !diff.cmds.length}
                onClick={async () => {
                  await send(diff.cmds);
                  toast(tr("Sent {n} edited bytes to the running game (temporary)", { n: diff.bytes }), "ok");
                }}
              >{tr("⚡ Push my ROM edits live ({n} bytes)", { n: diff.bytes })}</button>
              <button className="btn" disabled={!connected || !diff.cmds.length} onClick={() => send(romDiffCmds(rs, true).cmds)}>{tr("Restore original bytes live")}</button>
            </div>
            {diff.skipped.map((s) => (
              <div key={s} className="muted small">{tr("not live:")}{" "}{s}
              </div>
            ))}
            <p className="muted small" style={{ margin: 0 }}>{tr("Program ROM (P1/P2) edits — animations, hitboxes, inputs, code, hooks — can be applied to the running game without rebuilding. They last until the game is reset. Tiles and sound need an exported ROM.")}</p>
            <div className="row">
              <label className="f">
                <input
                  type="checkbox"
                  checked={overlay}
                  disabled={!connected}
                  onChange={(e) => {
                    setOverlay(e.target.checked);
                    send([`overlay ${e.target.checked ? 1 : 0}`]);
                  }}
                />{" "}{tr("draw hitboxes in the emulator (training mode colors)")}</label>
            </div>
            <div className="row">
              <button className="btn sm" disabled={!connected} onClick={() => send(["save quick.fs"])}>{tr("Save state")}</button>
              <button className="btn sm" disabled={!connected} onClick={() => send(["load quick.fs"])}>{tr("Load state")}</button>
              <button className="btn sm" disabled={!connected} onClick={() => send(["freeze 1 10A83A 60"])}>{tr("Freeze timer")}</button>
              <button className="btn sm" disabled={!connected} onClick={() => send(["unfreeze 10A83A"])}>{tr("Unfreeze timer")}</button>
            </div>
          </div>
        </Panel>
      </div>
      {connected && state && k && (
        <>
          <div className="grid2">
            {state.p1 && <PlayerCard name="P1" p={state.p1} moves={p1Moves} />}
            {state.p2 && <PlayerCard name="P2" p={state.p2} moves={p2Moves} />}
          </div>
          <Panel title={tr("Moves the game just executed")}>
            {!state.dispatchHook && <div className="notice small">{tr("The dispatcher watch could not be installed in this FBNeo build.")}</div>}
            <table className="t">
              <tbody>
                {state.dispatch.map((d, i) => (
                  <tr key={i}>
                    <td className="mono small">{tr("frame")}{" "}{d.frame}</td>
                    <td>{d.obj === OBJ.P1 ? "P1" : d.obj === OBJ.P2 ? "P2" : hex(d.obj, 6)}</td>
                    <td className="mono">${hex(d.routine, 6)}</td>
                    <td className="small muted">{label(d.routine)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <div className="grid2">
            {state.p1 && <MoveTrigger who="P1" ch={state.p1.ch} moves={p1Moves} />}
            {state.p2 && <MoveTrigger who="P2" ch={state.p2.ch} moves={p2Moves} />}
          </div>
        </>
      )}
      <InjectorPanel p1Moves={p1Moves} p2Moves={p2Moves} />
      <RamPanel />
    </div>
  );
}
