import React, { useEffect, useMemo, useState } from "react";
import { hex } from "../core/bytes";
import { cPairs, readPalette } from "../core/gfx";
import { KOF_PALETTES } from "../games/kofPalettes";
import { p2OffsetToCpu } from "./PalettesView";
import { findFreeSpace } from "../core/analysis";
import {
  ActCmd,
  actFrames,
  actPointer,
  decodeSpriteDef,
  describeCancel,
  describeEffect,
  describeSelect,
  graphEntry,
  imageTableFor,
  kofBanks,
  listActs,
  p1ActMap,
  parseAct,
  scanImageTables,
  serializeAct,
  SpriteLayout,
} from "../games/kofEngine";
import { useApp } from "../store";
import { LiveButton, writeCmds } from "../live/live";
import { TM_BOX_COLORS, tmBoxKind } from "../games/profiles";
import { downloadBytes, Empty, HexInput, imageFileToRgba, NeedRom, Panel, pickFile, useActivePalette, useRgba } from "../ui/common";
import { applyFrameImport, frameToPng, planFrameImport, readFrame, sharedTiles } from "../games/framePng";
import type { SpriteDef } from "../games/kofEngine";
import { blockPixels } from "../ui/sprite";
import { CommandsPanel } from "./CommandsPanel";
import { RoutinesPanel } from "./RoutinesPanel";
import { MoveListPanel } from "./MoveListPanel";
import { tr, Tx } from "../i18n";
import { askText } from "../ui/ask";


// P1 "start codes" used by normals (from the KOF97 P2 tutorial)
export const NORMAL_ACTS: Record<number, string> = {
  0x50: "stand A", 0x51: "far A", 0x52: "jump A (neutral)", 0x53: "jump A", 0x54: "crouch A",
  0x55: "stand B", 0x56: "far B", 0x57: "jump B (neutral)", 0x58: "jump B", 0x59: "crouch B",
  0x5a: "close C", 0x5b: "far C", 0x5c: "jump C (neutral)", 0x5d: "jump C", 0x5e: "crouch C",
  0x5f: "close D", 0x60: "far D", 0x61: "jump D (neutral)", 0x62: "jump D", 0x63: "crouch D",
  0x64: "CD attack", 0x65: "jump CD", 0x66: "counter CD",
};

type Sub = "act" | "moves" | "cmd" | "routines";
let lastSub: Sub = "act";

export function CharsView() {
  const { rs, profile } = useApp();
  const [sub, setSubState] = useState<Sub>(lastSub);
  const setSub = (s: Sub) => {
    lastSub = s;
    setSubState(s);
  };
  if (!rs) return <NeedRom />;
  const k = profile.kof;
  if (!k)
    return (
      <Empty>
        <p>
          <Tx s="Character data needs a KOF engine profile (detected: **{name}**)." vars={{ name: profile.name }} />
        </p>
        <p>{tr("Supported: KOF97 (documented) and KOF98 (experimental). Other games still work in the tile, palette, code, hook and hex views.")}</p>
      </Empty>
    );
  return (
    <div className="col">
      <div className="row">
        {(
          [
            ["act", "Animations, frames & hitboxes"],
            ["moves", "Move list (complete moves)"],
            ["cmd", "Command inputs"],
            ["routines", "Move routines (code)"],
          ] as [Sub, string][]
        ).map(([s, l]) => (
          <button key={s} className={"btn" + (sub === s ? " on" : "")} onClick={() => setSub(s)}>
            {tr(l)}
          </button>
        ))}
        {profile.status === "experimental" && <span className="warn small">{tr("Experimental profile — verify in MAME.")}</span>}
      </div>
      {sub === "act" && <ActEditor />}
      {sub === "moves" && <MoveListPanel />}
      {sub === "cmd" && <CommandsPanel />}
      {sub === "routines" && <RoutinesPanel />}
    </div>
  );
}

const IMG_KEY = "nghs.imageTables";

function ActEditor() {
  const { rs, profile, version, toast, paletteName } = useApp();
  const k = profile.kof!;
  const banks = rs ? kofBanks(rs, k) : null;
  const [ch, setCh] = useState(0);
  const [act, setAct] = useState<number | null>(null);
  const [draft, setDraft] = useState<ActCmd[] | null>(null);
  const [frameSel, setFrameSel] = useState(0);
  const [cmdSel, setCmdSel] = useState<number | null>(null);
  const [mirror, setMirror] = useState(true);
  const [showSprite, setShowSprite] = useState(true);
  const [layout, setLayout] = useState<SpriteLayout>("masked");
  const [playing, setPlaying] = useState(false);
  const [imgTables, setImgTables] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(IMG_KEY) ?? "{}");
    } catch {
      return {};
    }
  });
  const pal = useActivePalette();
  const rgba = useRgba(pal);
  const pairs = useMemo(() => (rs ? cPairs(rs) : []), [rs]);

  const acts = useMemo(() => (rs && banks ? listActs(rs, k, banks.actBank, ch) : []), [rs, banks?.actBank, ch, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const p1map = useMemo(() => (rs ? p1ActMap(rs, k, ch) : []), [rs, ch, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = act !== null ? acts.find((a) => a.act === act) : undefined;
  const script = useMemo(() => (rs && banks && cur?.valid ? parseAct(rs, banks.actBank, cur.addr) : null), [rs, banks?.actBank, cur?.addr, version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft(script ? script.cmds.map((c) => ({ ...c })) : null);
    setFrameSel(0);
    setCmdSel(null);
  }, [script]);

  const cmds = draft ?? script?.cmds ?? [];
  const frames = useMemo(() => actFrames({ addr: 0, bank: 0, cmds, size: 0, terminated: true }), [cmds]);
  const frame = frames[Math.min(frameSel, frames.length - 1)];
  const dirty = !!(draft && script && serializeAct(draft).join() !== serializeAct(script.cmds).join());

  // animation playback
  useEffect(() => {
    if (!playing || !frames.length) return;
    let f = frameSel, left = Math.max(1, frames[f]?.cmd.dur ?? 1);
    const id = setInterval(() => {
      left--;
      if (left <= 0) {
        f = (f + 1) % frames.length;
        left = Math.max(1, frames[f].cmd.dur);
        setFrameSel(f);
      }
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [playing, frames]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!rs) return null;
  if (!banks) return <Empty>{tr("Could not find the graph/ACT banks (ids {g}/{a}). Is the P2 ROM loaded?", { g: k.graphBankId, a: k.actBankId })}</Empty>;

  const imgKey = `${rs.setName}:${ch}`;
  const imageTable = imgTables[imgKey] ?? imageTableFor(rs, k, banks.imageBank, ch);
  const setImageTable = (v: number) => {
    const n = { ...imgTables, [imgKey]: v };
    setImgTables(n);
    try {
      localStorage.setItem(IMG_KEY, JSON.stringify(n));
    } catch {
      /* ignore */
    }
  };

  // ---- preview ----
  const S = 2, CW = 320, CH = 260, OX = CW / 2, OY = 220;
  let spriteInfo: string | null = null;
  let sprite: { px: Uint8Array; w: number; h: number; x: number; y: number } | null = null;
  let spriteDef: { def: SpriteDef; image: number } | null = null;
  if (frame && showSprite) {
    const g = graphEntry(rs, k, banks.graphBank, ch, frame.cmd.frameId);
    if (imageTable) {
      const defAddr = rs.read32(imageTable + g.image * 4, banks.imageBank) & 0xffffff;
      if (defAddr >= 0x200000 && defAddr < 0x300000) {
        const def = decodeSpriteDef(rs, banks.imageBank, defAddr, layout);
        const px = blockPixels(rs, pairs, def.cells, def.cols, def.rows);
        sprite = { px, w: def.cols * 16, h: def.rows * 16, x: g.x, y: g.y };
        if (layout === "masked") spriteDef = { def, image: g.image };
        spriteInfo = `frame $${hex(frame.cmd.frameId, 4)} → graph $${hex(g.addr, 6)} (x ${g.x}, y ${g.y}, image $${hex(g.image, 4)}) → def $${hex(defAddr, 6)} [${def.raw
          .slice(0, 8)
          .map((b) => hex(b, 2))
          .join(" ")}] ${def.cols}×${def.rows} tiles from $${hex(def.baseTile, 5)}`;
      } else spriteInfo = tr("image pointer ${addr} is outside the graph bank — image table base is probably wrong", { addr: hex(defAddr, 6) });
    } else spriteInfo = tr("frame ${f} → graph ${g} (x {x}, y {y}, image ${i}). Set the image table to preview the sprite.", { f: hex(frame.cmd.frameId, 4), g: hex(g.addr, 6), x: g.x, y: g.y, i: hex(g.image, 4) });
  }

  // ---- replace this frame's art: export it as PNG, import an edited PNG into the same tiles ----
  const frameName = () => `${rs.setName}_${(profile.characters[ch] ?? "char" + ch).replace(/\W+/g, "_")}_act${hex(cur?.act ?? 0, 3)}_f${(frame?.index ?? 0) + 1}_img${hex(spriteDef?.image ?? 0, 4)}.png`;
  const exportFramePng = () => {
    if (!spriteDef) return;
    downloadBytes(frameToPng(readFrame(rs, pairs, spriteDef.def), pal), frameName(), "image/png");
    toast(tr("Exported {w}×{h} px with palette “{p}”. Faint pink = cells with no tile (can't be drawn on).", { w: spriteDef.def.cols * 16, h: spriteDef.def.rows * 16, p: paletteName }), "ok");
  };
  const importFramePng = async () => {
    if (!spriteDef || !imageTable || !cur) return;
    const f = await pickFile("image/png,image/*");
    if (!f) return;
    const { def, image } = spriteDef;
    const img = readFrame(rs, pairs, def);
    const plan = planFrameImport(rs, pairs, img, await imageFileToRgba(f), pal);
    if (plan.error === "size") return toast(tr("The PNG must be exactly {w}×{h} px, like the exported frame.", { w: img.w, h: img.h }), "error");
    if (plan.error === "opaque") return toast(tr("The PNG has no transparent pixels. Save it with transparency (index 0 / alpha)."), "error");
    const outside = plan.outsidePixels ? " " + tr("{n} pixels drawn in {c} cells with no tile were ignored.", { n: plan.outsidePixels, c: plan.outsideCells }) : "";
    if (!plan.tiles.size) return toast(tr("No pixel changed: nothing written.") + outside, plan.outsidePixels ? "error" : "ok");
    const count = scanImageTablesCached(rs, banks.imageBank).find((c) => c.addr === imageTable)?.count ?? 0;
    const shared = sharedTiles(rs, banks.imageBank, imageTable, count, image, plan.tiles.keys());
    if (shared.tiles && !confirm(tr("{n} of the tiles you changed are also used by {m} other image(s) of this character ({list}). They will change too. Continue?", { n: shared.tiles, m: shared.images.length, list: shared.images.slice(0, 8).map((i) => "$" + hex(i, 3)).join(" ") }))) return;
    applyFrameImport(rs, pairs, plan, `frame PNG → image $${hex(image, 3)}`);
    toast(tr("Wrote {px} changed pixels into {t} tiles of image ${img}.", { px: plan.changedPixels, t: plan.tiles.size, img: hex(image, 3) }) + outside + (plan.conflicts ? " " + tr("{n} pixels conflicted between cells that share a tile (first edit kept).", { n: plan.conflicts }) : ""), "ok");
  };

  const drawPreview = (canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, CW * S, CH * S);
    ctx.imageSmoothingEnabled = false;
    // ground + origin
    ctx.strokeStyle = "#3a4260";
    ctx.beginPath();
    ctx.moveTo(0, OY * S);
    ctx.lineTo(CW * S, OY * S);
    ctx.moveTo(OX * S, 0);
    ctx.lineTo(OX * S, CH * S);
    ctx.stroke();
    if (sprite) {
      const off = document.createElement("canvas");
      off.width = sprite.w;
      off.height = sprite.h;
      const octx = off.getContext("2d")!;
      const img = octx.createImageData(sprite.w, sprite.h);
      for (let i = 0; i < sprite.px.length; i++) {
        const c = rgba[sprite.px[i]];
        if (c && c[3]) img.data.set([c[0], c[1], c[2], 255], i * 4);
      }
      octx.putImageData(img, 0, 0);
      // checked in FBNeo: sprites are stored facing left; facing right flips them (and negates box X)
      ctx.save();
      if (mirror) {
        ctx.translate(OX * S, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(off, sprite.x * S, (OY + sprite.y) * S, sprite.w * S, sprite.h * S);
      } else ctx.drawImage(off, (OX + sprite.x) * S, (OY + sprite.y) * S, sprite.w * S, sprite.h * S);
      ctx.restore();
    }
    if (!frame) return;
    frame.slots.forEach((b, slot) => {
      if (!b) return;
      const active = !!(frame.cmd.select & (1 << slot));
      const color = TM_BOX_COLORS[tmBoxKind(b.type, ch === 0x20)];
      const cx = OX + (mirror ? -b.x : b.x), cy = OY + b.y;
      ctx.globalAlpha = active ? 1 : 0.25;
      ctx.strokeStyle = color;
      ctx.lineWidth = active ? 2 : 1;
      ctx.setLineDash(active ? [] : [4, 4]);
      ctx.strokeRect((cx - b.w) * S, (cy - b.h) * S, b.w * 2 * S, b.h * 2 * S);
      ctx.fillStyle = color + "40";
      if (active) ctx.fillRect((cx - b.w) * S, (cy - b.h) * S, b.w * 2 * S, b.h * 2 * S);
      ctx.fillStyle = color;
      ctx.font = "11px monospace";
      ctx.fillText(`${slot}:${hex(b.type, 2)}`, (cx - b.w) * S + 2, (cy - b.h) * S + 11);
    });
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  };

  const update = (i: number, patch: Partial<ActCmd>) => {
    const n = [...cmds];
    n[i] = { ...n[i], ...patch } as ActCmd;
    setDraft(n);
  };
  const insert = (i: number, c: ActCmd) => {
    const n = [...cmds];
    n.splice(i, 0, c);
    setDraft(n);
  };
  const remove = (i: number) => setDraft(cmds.filter((_, k2) => k2 !== i));

  const save = () => {
    if (!draft || !script || !cur) return;
    const bytes = serializeAct(draft);
    if (bytes.length <= script.size) {
      rs.writeCpu(script.addr, bytes, banks.actBank, `ACT ${hex(ch)}:${hex(cur.act)}`);
      toast(`ACT $${hex(cur.act)} written (${bytes.length} bytes)`, "ok");
      return;
    }
    // relocate into free space of the ACT bank
    const b = rs.banks[banks.actBank];
    const f = rs.files[b.file];
    const free = findFreeSpace(f.data, bytes.length + 16, b.offset, b.offset + 0x100000).find((x) => x.length >= bytes.length + 16);
    if (!free) return toast(tr("Script grew and no free space was found in the ACT bank"), "error");
    const newAddr = 0x200000 + free.offset - b.offset;
    rs.batch(`relocate ACT ${hex(ch)}:${hex(cur.act)}`, () => {
      rs.write(b.file, free.offset, bytes, "ACT script");
      rs.writeCpu(cur.slot, [(newAddr >>> 24) & 255, (newAddr >>> 16) & 255, (newAddr >>> 8) & 255, newAddr & 255], banks.actBank, "ACT pointer");
    });
    toast(tr("Script grew: moved to ${addr} and repointed ACT ${act}", { addr: hex(newAddr, 6), act: hex(cur.act) }), "ok");
  };

  const cloneToSlot = async () => {
    if (!script || !cur) return;
    const target = await askText(tr("Copy this ACT into which ACT slot number (hex)? The slot pointer will be changed to a new copy in free space."), hex(cur.act + 1));
    if (!target) return;
    const slotAct = parseInt(target, 16);
    const bytes = serializeAct(draft ?? script.cmds);
    const b = rs.banks[banks.actBank];
    const free = findFreeSpace(rs.files[b.file].data, bytes.length + 16, b.offset, b.offset + 0x100000).find((x) => x.length >= bytes.length + 16);
    if (!free) return toast(tr("No free space in the ACT bank"), "error");
    const newAddr = 0x200000 + free.offset - b.offset;
    const ptr = actPointer(rs, k, banks.actBank, ch, slotAct);
    rs.batch(`clone ACT to ${hex(slotAct)}`, () => {
      rs.write(b.file, free.offset, bytes, "ACT clone");
      rs.writeCpu(ptr.slot, [(newAddr >>> 24) & 255, (newAddr >>> 16) & 255, (newAddr >>> 8) & 255, newAddr & 255], banks.actBank, "ACT pointer");
    });
    toast(tr("ACT copied to slot ${slot} at ${addr}", { slot: hex(slotAct), addr: hex(newAddr, 6) }), "ok");
    setAct(slotAct);
  };

  const candidates = scanImageTablesCached(rs, banks.imageBank);
  const kyoIdx = k.imageTables?.[0] !== undefined ? candidates.findIndex((c) => c.addr === k.imageTables![0]) : -1;
  const guess = kyoIdx >= 0 ? candidates[kyoIdx + ch]?.addr : undefined;

  return (
    <div className="split3" style={{ gridTemplateColumns: "190px 230px minmax(0,1fr)" }}>
      <Panel title={tr("Character")} scroll>
        <table className="t">
          <tbody>
            {Array.from({ length: k.charCount }, (_, i) => (
              <tr key={i} className={"click" + (i === ch ? " sel" : "")} onClick={() => { setCh(i); setAct(null); }}>
                <td className="mono muted">{hex(i, 2)}</td>
                <td>{profile.characters[i] ?? "?"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title={tr("ACTs ({n})", { n: acts.length })} scroll>
        <table className="t">
          <tbody>
            {acts.map((a) => {
              const p1 = p1map.indexOf(a.act);
              return (
                <tr key={a.act} className={"click" + (a.act === act ? " sel" : "")} onClick={() => setAct(a.act)}>
                  <td className="mono">{hex(a.act, 3)}</td>
                  <td className="mono small muted">{a.valid ? hex(a.addr, 6) : "—"}</td>
                  <td className="small">{tr(NORMAL_ACTS[p1 >= 0 ? p1 : -1] ?? NORMAL_ACTS[a.act] ?? "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <div>
        {!script || !cur ? (
          <Panel title={tr("Animation")}>
            <p className="muted">{tr("Pick an ACT. Each ACT is one animation script: frames with durations, plus box (FD), sound (FC), movement (FB) and effect (FA) commands.")}</p>
            <p className="muted small">{tr("Table: ${t} (bank {b}) → ${p}", { t: hex(k.charTable + ch * 4, 6), b: banks.actBank, p: hex(rs.read32(k.charTable + ch * 4, banks.actBank) & 0xffffff, 6) })}
            </p>
          </Panel>
        ) : (
          <>
            <Panel
              title={`${profile.characters[ch]} · ACT $${hex(cur.act, 3)} @ $${hex(cur.addr, 6)} (bank ${banks.actBank})`}
              actions={
                <>
                  <button className="btn sm" onClick={() => setPlaying((p) => !p)}>
                    {playing ? "❚❚ Pause" : "▶ Play"}
                  </button>
                  <label className="f small">
                    <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />{" "}{tr("face right")}</label>
                  <label className="f small">
                    <input type="checkbox" checked={showSprite} onChange={(e) => setShowSprite(e.target.checked)} />{" "}{tr("sprite")}</label>
                </>
              }
            >
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="col">
                  <canvas ref={drawPreview} width={CW * S} height={CH * S} className="checker" style={{ width: CW * 1.5, height: CH * 1.5, borderRadius: 8 }} />
                  <div className="row" style={{ flexWrap: "wrap", maxWidth: CW * 1.5 }}>
                    <button className="btn sm" disabled={!spriteDef} onClick={exportFramePng} title={tr("Save this frame exactly as stored (facing left), using the active palette. Redraw it, keeping the size and transparency.")}>{tr("Export frame PNG")}</button>
                    <button className="btn sm" disabled={!spriteDef} onClick={importFramePng} title={tr("Write an edited PNG back into the same tiles this frame uses. Pixels in cells without a tile are reported, not written.")}>{tr("Import PNG into this frame")}</button>
                    <span className="small muted">{tr("palette:")} {paletteName}</span>
                  </div>
                  {!spriteDef && showSprite && frame && <span className="small muted">{tr("Needs the image table and the per-column row masks layout (Sprite preview setup).")}</span>}
                </div>
                <div className="col" style={{ flex: 1, minWidth: 240 }}>
                  {frame ? (
                    <div className="kv small">
                      <span>{tr("frame")}</span>
                      <span>
                        {tr("{i}/{n} · tick {t}", { i: frame.index + 1, n: frames.length, t: frame.startTick })}
                      </span>
                      <span>{tr("duration")}</span>
                      <span>{frame.cmd.dur}{" "}{tr("frames")}</span>
                      <span>{tr("image id")}</span>
                      <span className="mono">${hex(frame.cmd.frameId, 4)}</span>
                      <span>{tr("effect")}</span>
                      <span>{describeEffect(frame.cmd.effect)}</span>
                      <span>{tr("stun/cancel")}</span>
                      <span>{describeCancel(frame.cmd.cancel)}</span>
                      <span>{tr("boxes")}</span>
                      <span>{describeSelect(frame.cmd.select)}</span>
                      {frame.sounds.map((s, i) => (
                        <React.Fragment key={"s" + i}>
                          <span>{tr("sound")}</span>
                          <span className="mono">${hex(s.sound, 4)}</span>
                        </React.Fragment>
                      ))}
                      {frame.moves.map((m, i) => (
                        <React.Fragment key={"m" + i}>
                          <span>{tr("move")}</span>
                          <span className="mono">{tr("dx")}{" "}{m.dx}{" "}{tr("dy")}{" "}{m.dy}
                          </span>
                        </React.Fragment>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">{tr("No frames in this script.")}</p>
                  )}
                  <div className="legend" style={{ flexDirection: "column", gap: 2 }}>
                    {frame?.slots.map((b, i) =>
                      b ? (
                        <span key={i} style={{ opacity: frame.cmd.select & (1 << i) ? 1 : 0.5 }}>
                          <i style={{ background: TM_BOX_COLORS[tmBoxKind(b.type, ch === 0x20)] }} />{tr("slot")}{" "}{i} ({tr(tmBoxKind(b.type, ch === 0x20))}{frame.cmd.select & (1 << i) ? "" : ", inactive"}): {tr(profile.hitboxTypes?.[b.type & 0xfc]?.name ?? "type " + hex(b.type, 2))}
                        </span>
                      ) : null,
                    )}
                  </div>
                  <div className="legend" title={tr("Same colors as Fightcade's training mode hitbox viewer")}>
                    {(["vulnerability", "attack", "guard", "proj. vulnerability", "proj. attack"] as const).map((k2) => (
                      <span key={k2}>
                        <i style={{ background: TM_BOX_COLORS[k2] }} />
                        {tr(k2)}
                      </span>
                    ))}
                  </div>
                  <details>
                    <summary className="small muted">{tr("Sprite preview setup (experimental)")}</summary>
                    <div className="col small" style={{ marginTop: 6 }}>
                      <label className="f">{tr("image table")}{" "}<HexInput value={imageTable ?? 0} onChange={setImageTable} width={70} />
                        {guess && guess !== imageTable && (
                          <button className="btn sm" onClick={() => setImageTable(guess)}>{tr("use guess $")}{hex(guess, 6)}
                          </button>
                        )}
                      </label>
                      <label className="f">{tr("tile layout")}<select value={layout} onChange={(e) => setLayout(e.target.value as SpriteLayout)}>
                          <option value="masked">{tr("per-column row masks (KOF96-98)")}</option>
                          <option value="colmajor">{tr("consecutive, column order")}</option>
                          <option value="rowmajor">{tr("consecutive, row order")}</option>
                        </select>
                      </label>
                      <span className="muted">{spriteInfo}</span>
                      <span className="muted">{tr("Verified on real KOF97: image table from ${a} + char×4, definitions use per-column row masks. Other games may need another layout.", { a: (k.imagePtrTable ?? 0).toString(16).toUpperCase() })}</span>
                      <CharPaletteButtons name={profile.characters[ch] ?? ""} />
                    </div>
                  </details>
                </div>
              </div>
              <div className="timeline" style={{ marginTop: 10 }}>
                {frames.map((f) => (
                  <div key={f.index} className={"tf" + (f.index === frameSel ? " sel" : "")} onClick={() => { setFrameSel(f.index); setCmdSel(f.cmdIndex); }}>
                    <div>#{f.index + 1}</div>
                    <div className="mono">{hex(f.cmd.frameId, 3)}</div>
                    <div className="dur">{f.cmd.dur}f</div>
                    {f.activeBoxes.some((b) => tmBoxKind(b.type, ch === 0x20).endsWith("attack")) && <div className="hit">{tr("HIT")}</div>}
                  </div>
                ))}
              </div>
            </Panel>
            <Panel
              title={dirty ? tr("Script ({n} bytes, edited → {m})", { n: script.size, m: serializeAct(cmds).length }) : tr("Script ({n} bytes)", { n: script.size })}
              actions={
                <>
                  <button className="btn sm" onClick={() => insert(cmdSel ?? cmds.length - 1, { t: "frame", off: 0, dur: 4, effect: 0, frameId: frame?.cmd.frameId ?? 0, select: 0, cancel: 0 })}>{tr("+ frame")}</button>
                  <button className="btn sm" onClick={() => insert(cmdSel ?? cmds.length - 1, { t: "box", off: 0, type: 0x30, x: -32, y: -60, w: 16, h: 12 })}>{tr("+ box")}</button>
                  <button className="btn sm" onClick={() => insert(cmdSel ?? cmds.length - 1, { t: "sound", off: 0, p: 0, sound: 0x2c1, extra: 0 })}>{tr("+ sound")}</button>
                  <button className="btn sm" onClick={() => insert(cmdSel ?? cmds.length - 1, { t: "move", off: 0, p: 0, dx: -4, dy: 0 })}>{tr("+ move")}</button>
                  <button className="btn sm" disabled={!dirty} onClick={() => setDraft(script.cmds.map((c) => ({ ...c })))}>{tr("Revert")}</button>
                  <button className="btn sm" onClick={cloneToSlot}>{tr("Copy to ACT slot…")}</button>
                  <LiveButton label={tr("Try live")} cmds={() => writeCmds(rs, script.addr, serializeAct(cmds), banks.actBank)} title={tr("Send this script to the running game (temporary, nothing is written to the ROM file)")} />
                  <LiveButton
                    label={tr("Restore live")}
                    cmds={() => {
                      const l = rs.cpuToFile(script.addr, banks.actBank);
                      return l ? writeCmds(rs, script.addr, Array.from(rs.files[l.file].orig.subarray(l.offset, l.offset + script.size)), banks.actBank) : null;
                    }}
                    title={tr("Send the original script back to the running game")}
                  />
                  <button className="btn sm primary" disabled={!dirty} onClick={save}>{tr("Write to ROM")}</button>
                </>
              }
            >
              <div className="cmdlist mono">
                {cmds.map((c, i) => (
                  <CmdRow key={i} c={c} sel={cmdSel === i} onSel={() => {
                    setCmdSel(i);
                    const fi = frames.findIndex((f) => f.cmdIndex >= i);
                    if (fi >= 0) setFrameSel(fi);
                  }} onChange={(p) => update(i, p)} onRemove={() => remove(i)} />
                ))}
              </div>
              <p className="muted small">{tr("Sprites are stored facing left and box x is positive towards the back; “face right” mirrors both, like the game. w/h are half sizes. Colors follow Fightcade's training mode (blue = vulnerable, red = attack, lilac = guard, cyan = projectile). Box type low 2 bits = slot; a frame's “sel” low nibble picks which slots are active. If the script grows it is moved to free space in the bank and the ACT pointer is updated.")}</p>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

let imgScanCache: { key: string; v: { addr: number; count: number }[] } | null = null;
function scanImageTablesCached(rs: NonNullable<ReturnType<typeof useApp>["rs"]>, bank: number) {
  const key = rs.setName + ":" + bank + ":" + rs.version;
  if (!imgScanCache || imgScanCache.key !== key) imgScanCache = { key, v: scanImageTables(rs, bank) };
  return imgScanCache.v;
}

function H2({ v, on, w = 34 }: { v: number; on: (n: number) => void; w?: number }) {
  return <HexInput value={v & 0xffff} onChange={on} width={w} prefix="" />;
}

function CmdRow({ c, sel, onSel, onChange, onRemove }: { c: ActCmd; sel: boolean; onSel: () => void; onChange: (p: Partial<ActCmd>) => void; onRemove: () => void }) {
  const { profile } = useApp();
  let body: React.ReactNode;
  switch (c.t) {
    case "frame":
      body = (
        <span className="row">{tr("dur")}{" "}<H2 v={c.dur} on={(v) => onChange({ dur: v & 0x7f })} w={26} />{tr("eff")}{" "}<H2 v={c.effect} on={(v) => onChange({ effect: v & 0xff })} w={26} />{tr("img")}{" "}<H2 v={c.frameId} on={(v) => onChange({ frameId: v & 0xffff })} w={40} />{tr("sel")}{" "}<H2 v={c.select} on={(v) => onChange({ select: v & 0xff })} w={26} />{tr("stun/cxl")}{" "}<H2 v={c.cancel} on={(v) => onChange({ cancel: v & 0xff })} w={26} />
          <span className="muted small">{describeSelect(c.select)}</span>
        </span>
      );
      break;
    case "box":
      body = (
        <span className="row">{tr("type")}{" "}<H2 v={c.type} on={(v) => onChange({ type: v & 0xff })} w={26} />
          x <input type="number" value={c.x} onChange={(e) => onChange({ x: Math.max(-128, Math.min(127, +e.target.value)) })} />
          y <input type="number" value={c.y} onChange={(e) => onChange({ y: Math.max(-128, Math.min(127, +e.target.value)) })} />
          w <input type="number" value={c.w} onChange={(e) => onChange({ w: Math.max(0, Math.min(255, +e.target.value)) })} />
          h <input type="number" value={c.h} onChange={(e) => onChange({ h: Math.max(0, Math.min(255, +e.target.value)) })} />
          <span className="muted small">{tr("slot")}{" "}{c.type & 3} · {tr(profile.hitboxTypes?.[c.type & 0xfc]?.name ?? "?")}
          </span>
        </span>
      );
      break;
    case "sound":
      body = (
        <span className="row">
          p <H2 v={c.p} on={(v) => onChange({ p: v & 0xff })} w={26} />{" "}{tr("sound")}{" "}<H2 v={c.sound} on={(v) => onChange({ sound: v })} w={40} />{" "}{tr("extra")}{" "}<H2 v={c.extra} on={(v) => onChange({ extra: v })} w={40} />
        </span>
      );
      break;
    case "move":
      body = (
        <span className="row">
          p <H2 v={c.p} on={(v) => onChange({ p: v & 0xff })} w={26} />{" "}{tr("dx")}{" "}<input type="number" value={c.dx} onChange={(e) => onChange({ dx: +e.target.value })} />{" "}{tr("dy")}{" "}
          <input type="number" value={c.dy} onChange={(e) => onChange({ dy: +e.target.value })} />
        </span>
      );
      break;
    case "fx":
      body = (
        <span className="row">{tr("kind")}{" "}<H2 v={c.kind} on={(v) => onChange({ kind: v & 0xff })} w={26} /> a <H2 v={c.a} on={(v) => onChange({ a: v })} w={40} /> b <H2 v={c.b} on={(v) => onChange({ b: v })} w={40} />
          {c.kind === 0x3c && <span className="muted small">{tr("superflash")}</span>}
        </span>
      );
      break;
    case "end":
      body = (
        <span className="row">
          <select value={c.loop ? "ff" : "fe"} onChange={(e) => onChange({ loop: e.target.value === "ff" })}>
            <option value="fe">{tr("FE end (play once)")}</option>
            <option value="ff">{tr("FF loop")}</option>
          </select>{tr("arg")}{" "}<H2 v={c.arg} on={(v) => onChange({ arg: v & 0xff })} w={26} />
        </span>
      );
      break;
    case "raw":
      body = <span>{c.bytes.map((b) => hex(b, 2)).join(" ")}</span>;
  }
  const names = { frame: "frame", box: "FD box", sound: "FC sound", move: "FB move", fx: "FA fx", end: "end", raw: "raw" };
  return (
    <div className={"cmd" + (sel ? " sel" : "")} onClick={onSel}>
      <span className="muted small">+{hex(c.off, 3)}</span>
      <span>
        <span className={"pill " + c.t}>{names[c.t]}</span>
      </span>
      <span className="row" style={{ justifyContent: "space-between" }}>
        {body}
        {c.t !== "end" && (
          <button className="btn sm" onClick={(e) => { e.stopPropagation(); onRemove(); }} title={tr("remove")}>
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

/** Quick buttons to load this character's palette variants (matched by name from the palette notes). */
function CharPaletteButtons({ name }: { name: string }) {
  const { rs, profile, setPalette } = useApp();
  if (!rs || !profile.paletteSet) return null;
  const key = name.toLowerCase().replace(/^orochi /, "").split(" ")[0];
  const list = (KOF_PALETTES[profile.paletteSet] ?? []).filter((e) => key && e.name.toLowerCase().includes(key));
  if (!list.length) return <span className="muted">{tr("No named palette for this character; pick one in the Palettes tab.")}</span>;
  return (
    <span className="row">{tr("palette:")}{list.slice(0, 8).map((e) => {
        const loc = p2OffsetToCpu(rs, e.p2 - 2);
        return (
          <button key={e.p2} className="btn sm" disabled={!loc} onClick={() => loc && setPalette(readPalette(rs, loc.addr, loc.bank), `${e.name} ${e.variant}`, loc)}>
            {e.variant}
          </button>
        );
      })}
    </span>
  );
}
