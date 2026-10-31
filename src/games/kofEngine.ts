// SNK KOF engine data (KOF96-98 family): ACT animation scripts, boxes, graph tables, command inputs.
import { s16, s8 } from "../core/bytes";
import { disasm } from "../core/m68k/disasm";
import { routineToAsm } from "../core/relocate";
import type { RomSet } from "../core/romset";
import type { KofLayout } from "./profiles";
import { tr } from "../i18n";

// ---------------- ACT scripts ----------------
// Script = sequence of 6 byte groups, big-endian (68k view):
//   frame : [dur 00-7F][effect][frameId.w][select][stun/cancel]
//   FD box: [FD][type][x.s8][y.s8][w][h]        type low 2 bits = box slot, high 6 bits = judgment type
//   FC snd: [FC][p][sound.w][extra.w]
//   FB mov: [FB][p][dx.w][dy.w]
//   FA fx : [FA][kind][a.w][b.w]
//   FE/FF : [FE|FF][arg]  2 bytes, end of action (FE = once, FF = loop)

export type ActCmd =
  | { t: "frame"; off: number; dur: number; effect: number; frameId: number; select: number; cancel: number }
  | { t: "box"; off: number; type: number; x: number; y: number; w: number; h: number }
  | { t: "sound"; off: number; p: number; sound: number; extra: number }
  | { t: "move"; off: number; p: number; dx: number; dy: number }
  | { t: "fx"; off: number; kind: number; a: number; b: number }
  | { t: "end"; off: number; loop: boolean; arg: number }
  | { t: "raw"; off: number; bytes: number[] };

export interface ActScript {
  addr: number;
  bank: number;
  cmds: ActCmd[];
  size: number;
  terminated: boolean;
}

export function parseAct(rs: RomSet, bank: number, addr: number, maxBytes = 4096): ActScript {
  const cmds: ActCmd[] = [];
  let p = 0;
  let terminated = false;
  while (p < maxBytes) {
    const a = addr + p;
    const b0 = rs.read8(a, bank);
    const b1 = rs.read8(a + 1, bank);
    if (b0 === 0xfe || b0 === 0xff) {
      cmds.push({ t: "end", off: p, loop: b0 === 0xff, arg: b1 });
      p += 2;
      terminated = true;
      break;
    }
    const w2 = rs.read16(a + 2, bank), w4 = rs.read16(a + 4, bank);
    const b2 = rs.read8(a + 2, bank), b3 = rs.read8(a + 3, bank), b4 = rs.read8(a + 4, bank), b5 = rs.read8(a + 5, bank);
    if (b0 < 0x80) cmds.push({ t: "frame", off: p, dur: b0, effect: b1, frameId: w2, select: b4, cancel: b5 });
    else if (b0 === 0xfd) cmds.push({ t: "box", off: p, type: b1, x: s8(b2), y: s8(b3), w: b4, h: b5 });
    else if (b0 === 0xfc) cmds.push({ t: "sound", off: p, p: b1, sound: w2, extra: w4 });
    else if (b0 === 0xfb) cmds.push({ t: "move", off: p, p: b1, dx: s16(w2), dy: s16(w4) });
    else if (b0 === 0xfa) cmds.push({ t: "fx", off: p, kind: b1, a: w2, b: w4 });
    else cmds.push({ t: "raw", off: p, bytes: [b0, b1, b2, b3, b4, b5] });
    p += 6;
  }
  return { addr, bank, cmds, size: p, terminated };
}

export function serializeCmd(c: ActCmd): number[] {
  const w = (v: number) => [(v >> 8) & 0xff, v & 0xff];
  switch (c.t) {
    case "frame":
      return [c.dur & 0x7f, c.effect & 0xff, ...w(c.frameId), c.select & 0xff, c.cancel & 0xff];
    case "box":
      return [0xfd, c.type & 0xff, c.x & 0xff, c.y & 0xff, c.w & 0xff, c.h & 0xff];
    case "sound":
      return [0xfc, c.p & 0xff, ...w(c.sound), ...w(c.extra)];
    case "move":
      return [0xfb, c.p & 0xff, ...w(c.dx), ...w(c.dy)];
    case "fx":
      return [0xfa, c.kind & 0xff, ...w(c.a), ...w(c.b)];
    case "end":
      return [c.loop ? 0xff : 0xfe, c.arg & 0xff];
    case "raw":
      return c.bytes.slice(0, 6);
  }
}

export function serializeAct(cmds: ActCmd[]): Uint8Array {
  return Uint8Array.from(cmds.flatMap(serializeCmd));
}

/** One displayed frame: the frame command plus the box state active while it shows. */
export interface ActFrame {
  index: number;
  cmd: Extract<ActCmd, { t: "frame" }>;
  cmdIndex: number;
  slots: (Extract<ActCmd, { t: "box" }> | null)[];
  activeBoxes: Extract<ActCmd, { t: "box" }>[];
  sounds: Extract<ActCmd, { t: "sound" }>[];
  moves: Extract<ActCmd, { t: "move" }>[];
  fx: Extract<ActCmd, { t: "fx" }>[];
  startTick: number;
}

export function actFrames(script: ActScript): ActFrame[] {
  const slots: (Extract<ActCmd, { t: "box" }> | null)[] = [null, null, null, null];
  let pendingSound: Extract<ActCmd, { t: "sound" }>[] = [];
  let pendingMove: Extract<ActCmd, { t: "move" }>[] = [];
  let pendingFx: Extract<ActCmd, { t: "fx" }>[] = [];
  const frames: ActFrame[] = [];
  let tick = 0;
  script.cmds.forEach((c, i) => {
    if (c.t === "box") slots[c.type & 3] = c;
    else if (c.t === "sound") pendingSound.push(c);
    else if (c.t === "move") pendingMove.push(c);
    else if (c.t === "fx") pendingFx.push(c);
    else if (c.t === "frame") {
      const sel = c.select & 0x0f;
      const active = slots.filter((s, k) => s && sel & (1 << k)) as Extract<ActCmd, { t: "box" }>[];
      frames.push({
        index: frames.length,
        cmd: c,
        cmdIndex: i,
        slots: [...slots],
        activeBoxes: active,
        sounds: pendingSound,
        moves: pendingMove,
        fx: pendingFx,
        startTick: tick,
      });
      tick += Math.max(1, c.dur);
      pendingSound = [];
      pendingMove = [];
      pendingFx = [];
    }
  });
  return frames;
}

export const EFFECT_NAMES = ["normal", "blood", "fire #1", "purple flame", "electric", "fire #2", "?", "critical", "guard crush", "blood+crush", "fire1+crush", "purple+crush", "electric+crush", "fire2+crush", "?+crush", "critical+crush"];
export const LEVEL_NAMES: Record<number, string> = { 0: "mid", 4: "low", 8: "high", 0xc: "unblockable", 3: "mid, no pushback", 7: "low, no pushback", 0xb: "high, no pushback", 0xf: "unblockable, no pushback" };
export const STUN_NAMES = ["14f (std)", "10f", "5f", "11f", "3f", "8f", "47f", "30f", "unchanged (proj/air)"];
export const CANCEL_NAMES: Record<number, string> = {
  0: "no cancel", 4: "cancel to special/super", 8: "cancel to special only", 0xc: "full cancel",
  1: "no cancel, weak AA juggle", 2: "no cancel, OTG", 5: "special/super + weak AA", 6: "special/super + OTG",
  9: "special + weak AA", 0xa: "special + OTG", 0xd: "full + weak AA", 0xe: "full + OTG",
};
export const SELECT_FLAG_NAMES: Record<number, string> = { 0: "", 1: "superflash on hit", 2: "projectile", 3: "projectile", 4: "cancel next hit", 5: "cancel next hit", 6: "cancel next hit", 7: "cancel next hit", 8: "zero recovery" };

export function describeEffect(effect: number) {
  return `${tr(EFFECT_NAMES[effect >> 4] ?? "?")} · ${LEVEL_NAMES[effect & 15] ? tr(LEVEL_NAMES[effect & 15]) : tr("level {n}", { n: effect & 15 })}`;
}
export function describeCancel(v: number) {
  return `${tr("stun")} ${tr(STUN_NAMES[v >> 4] ?? "?")} · ${CANCEL_NAMES[v & 15] ? tr(CANCEL_NAMES[v & 15]) : tr("cancel {n}", { n: v & 15 })}`;
}
export function describeSelect(v: number) {
  const slots = [0, 1, 2, 3].filter((k) => v & (1 << k));
  const flag = SELECT_FLAG_NAMES[v >> 4] !== undefined ? tr(SELECT_FLAG_NAMES[v >> 4]) : tr("flags {n}", { n: (v >> 4).toString(16) });
  return `${slots.length ? tr("boxes {list}", { list: slots.join("+") }) : tr("no boxes (invincible)")}${flag ? " · " + flag : ""}`;
}

// ---------------- tables ----------------

export interface KofTables {
  /** frame list: frame id -> x/y offset + image number */
  graphBank: number;
  /** image tables and sprite definitions (same as graphBank before KOF2002) */
  imageBank: number;
  actBank: number;
}

export function kofBanks(rs: RomSet, k: KofLayout): KofTables | null {
  const graphBank = rs.bankById(k.graphBankId);
  const actBank = rs.bankById(k.actBankId);
  const imageBank = k.imageBankId !== undefined ? rs.bankById(k.imageBankId) : graphBank;
  if (graphBank < 0 || actBank < 0 || imageBank < 0) return null;
  return { graphBank, imageBank, actBank };
}

export function actTableBase(rs: RomSet, k: KofLayout, bank: number, ch: number) {
  return rs.read32(k.charTable + ch * 4, bank) & 0xffffff;
}

export function actPointer(rs: RomSet, k: KofLayout, bank: number, ch: number, act: number) {
  const base = actTableBase(rs, k, bank, ch);
  return { slot: base + act * 4, addr: rs.read32(base + act * 4, bank) & 0xffffff };
}

export interface ActListEntry {
  act: number;
  slot: number;
  addr: number;
  valid: boolean;
}

export function listActs(rs: RomSet, k: KofLayout, bank: number, ch: number): ActListEntry[] {
  const base = actTableBase(rs, k, bank, ch);
  const out: ActListEntry[] = [];
  if (base < 0x200000 || base >= 0x300000) return out;
  for (let act = 0; act < k.actsPerChar; act++) {
    const slot = base + act * 4;
    const raw = rs.read32(slot, bank);
    if (raw === 0xffffffff) continue;
    const addr = raw & 0xffffff;
    const valid = addr >= 0x200000 && addr < 0x300000 && !(addr & 1);
    if (!valid && act > 8 && raw === 0) continue;
    out.push({ act, slot, addr, valid });
  }
  return out;
}

/** Graph entry for a frame id: screen offset of the sprite and image index. */
export function graphEntry(rs: RomSet, k: KofLayout, graphBank: number, ch: number, frameId: number) {
  const base = rs.read32(k.charTable + ch * 4, graphBank) & 0xffffff;
  const a = base + frameId * 6;
  return { addr: a, x: s16(rs.read16(a, graphBank)), y: s16(rs.read16(a + 2, graphBank)), image: rs.read16(a + 4, graphBank) };
}

/** Candidate image-pointer tables in the graph bank: long runs of increasing pointers into the bank. */
/** Image table of a character: from the per-character pointer table when the profile knows it. */
export function imageTableFor(rs: RomSet, k: KofLayout, graphBank: number, ch: number): number | undefined {
  if (k.imagePtrTable !== undefined) {
    const v = rs.read32(k.imagePtrTable + ch * 4, graphBank) & 0xffffff;
    if (v >= 0x200000 && v < 0x300000) return v;
  }
  return k.imageTables?.[ch];
}

export function scanImageTables(rs: RomSet, graphBank: number, minRun = 24): { addr: number; count: number }[] {
  const out: { addr: number; count: number }[] = [];
  let a = 0x200002;
  const end = 0x300000;
  while (a < end - 4) {
    let n = 0, prev = 0;
    while (a + n * 4 < end) {
      const v = rs.read32(a + n * 4, graphBank);
      if (v < 0x200000 || v >= 0x300000 || v & 1 || v < prev) break;
      prev = v;
      n++;
    }
    if (n >= minRun) {
      out.push({ addr: a, count: n });
      a += n * 4;
    } else a += 2;
  }
  return out;
}

// ---------------- sprite definitions (experimental) ----------------

export type SpriteLayout = "colmajor" | "rowmajor" | "masked";

export interface SpriteDef {
  addr: number;
  mode: number;
  cols: number;
  rows: number;
  baseTile: number;
  raw: number[];
  /** tile number per cell (row-major, -1 = empty) */
  cells: number[];
}

/**
 * KOF96-98 sprite definition: [10 tt][cols][rows] + data. Type tt (checked on all KOF97 images):
 *   0/1 first tile (long) + row masks (word/byte) -> consecutive tiles
 *   3   tile high bits + 16-bit tile list, every cell used
 *   7/8 tile high bits + row masks (word/byte) + 16-bit tile per used cell
 *   9/A tile mid/high bits + row masks (word/byte) + 8-bit tile per used cell
 *   6   empty frame;  2 and 5 are rare and not decoded yet
 * Masks: one per column, top row = most significant bit. Cells go column by column, top to bottom.
 */
export function decodeSpriteDef(rs: RomSet, graphBank: number, addr: number, layout: SpriteLayout): SpriteDef {
  const mode = rs.read16(addr, graphBank);
  const size = rs.read16(addr + 2, graphBank);
  const cols = Math.max(1, Math.min(32, size >> 8));
  const rows = Math.max(1, Math.min(32, size & 0xff));
  const type = mode & 0xff;
  const raw = Array.from(rs.readBytes(addr, 8 + cols * 2 + 16, graphBank));
  const cells = new Array(cols * rows).fill(-1);
  let baseTile = 0;
  let p = addr + 4;
  const consecutive = type === 0 || type === 1;
  const list16 = type === 3 || type === 7 || type === 8;
  const list8 = type === 9 || type === 0x0a;
  if (layout !== "masked") {
    baseTile = rs.read32(addr + 4, graphBank) & 0xfffff;
    let t = baseTile;
    if (layout === "rowmajor") for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = t++;
    else for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells[r * cols + c] = t++;
    return { addr, mode, cols, rows, baseTile, raw, cells };
  }
  if (!consecutive && !list16 && !list8) return { addr, mode, cols, rows, baseTile, raw, cells };
  let hi = 0, mid = 0;
  if (consecutive) {
    baseTile = rs.read32(p, graphBank) & 0xfffff;
    p += 4;
  } else {
    mid = rs.read8(p, graphBank);
    hi = (rs.read8(p + 1, graphBank) >> 4) & 0x0f;
    baseTile = (hi << 16) | (list8 ? mid << 8 : 0);
    p += 2;
  }
  // masks
  const wordMasks = type === 0 || type === 7 || type === 9;
  const masks: number[] = [];
  if (type === 3) for (let c = 0; c < cols; c++) masks.push(0xffff);
  else {
    for (let c = 0; c < cols; c++) masks.push(wordMasks ? rs.read16(p + c * 2, graphBank) : rs.read8(p + c, graphBank));
    p += cols * (wordMasks ? 2 : 1);
  }
  if (list16 && p & 1) p++;
  const top = type === 3 ? 0x8000 : wordMasks ? 0x8000 : 0x80;
  let t = baseTile;
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      if (!(masks[c] & (top >> r))) continue;
      if (consecutive) cells[r * cols + c] = t++;
      else if (list16) {
        cells[r * cols + c] = (hi << 16) | rs.read16(p, graphBank);
        p += 2;
      } else {
        cells[r * cols + c] = (hi << 16) | (mid << 8) | rs.read8(p, graphBank);
        p += 1;
      }
    }
  return { addr, mode, cols, rows, baseTile, raw, cells };
}

// ---------------- command (input motion) tables ----------------
// definition: [count][window][charge.w] then count x [compare mode][input]; "FF 00" = empty slot.

export const COMPARE_MODES: Record<number, string> = {
  0x00: "equal (strict)",
  0x04: "contains",
  0x08: "contains ABCD",
  0x0c: "sub 12AA2",
  0x10: "hold (charge)",
  0x14: "contains directions",
  0x18: "directions, not ABCD",
  0x1c: "ABCD, not directions",
  0x20: "charge release (down-up)",
  0x24: "charge release",
  0x28: "sub 12D0A (loose)",
  0x2c: "confirm (97+)",
};

export interface CommandStep {
  mode: number;
  input: number;
}

export interface CommandDef {
  addr: number;
  empty: boolean;
  count: number;
  window: number;
  charge: number;
  steps: CommandStep[];
  size: number;
}

export function parseCommand(rs: RomSet, addr: number): CommandDef {
  const b0 = rs.read8(addr), b1 = rs.read8(addr + 1);
  if (b0 === 0xff) return { addr, empty: true, count: 0, window: 0, charge: 0, steps: [], size: 2 };
  const count = Math.min(b0, 16);
  const steps: CommandStep[] = [];
  for (let i = 0; i < count; i++) steps.push({ mode: rs.read8(addr + 4 + i * 2), input: rs.read8(addr + 5 + i * 2) });
  return { addr, empty: false, count, window: b1, charge: rs.read16(addr + 2), steps, size: 4 + count * 2 };
}

export function serializeCommand(c: CommandDef): number[] {
  if (c.empty) return [0xff, 0x00];
  return [c.steps.length & 0xff, c.window & 0xff, (c.charge >> 8) & 0xff, c.charge & 0xff, ...c.steps.flatMap((s) => [s.mode & 0xff, s.input & 0xff])];
}

/** numpad notation (facing right): 1..9 plus button letters */
export function inputToText(v: number): string {
  const up = v & 1, down = v & 2, left = v & 4, right = v & 8;
  let dir = "";
  if (v & 0x0f) {
    const y = up && !down ? 2 : down && !up ? 0 : 1;
    const x = left && !right ? 0 : right && !left ? 2 : 1;
    dir = String(y * 3 + x + 1);
    if ((up && down) || (left && right)) dir += "*";
  }
  const btn = ["A", "B", "C", "D"].filter((_, i) => v & (0x10 << i)).join("");
  if ((v & 0xf0) === 0xf0) return dir + (dir ? "+" : "") + "any";
  return dir + (btn ? (dir ? "+" : "") + btn : "") || "·";
}

export const ARROWS: Record<string, string> = { "1": "↙", "2": "↓", "3": "↘", "4": "←", "5": "·", "6": "→", "7": "↖", "8": "↑", "9": "↗" };
export function inputToArrows(v: number): string {
  const t = inputToText(v);
  return t.replace(/^[1-9]/, (d) => ARROWS[d]);
}

/** Find check tables: 16 consecutive longs pointing at command definitions. */
export function scanCommandTables(rs: RomSet, area: [number, number]): number[] {
  const [lo, hi] = area;
  const ok = (p: number) => {
    if (p === 0xffffffff) return true; // unused slot
    if (p < lo || p >= hi || p & 1) return false;
    const b0 = rs.read8(p);
    return b0 === 0xff || (b0 >= 1 && b0 <= 12);
  };
  const out: number[] = [];
  for (let a = lo; a + 64 <= hi; a += 2) {
    let good = true;
    for (let i = 0; i < 16 && good; i++) if (!ok(rs.read32(a + i * 4))) good = false;
    if (good) {
      out.push(a);
      a += 62;
    }
  }
  return out;
}

/** A character's command check table (13 slots + FFFFFFFF in KOF97). facing: 0 = left, 1 = right. */
export function commandTableFor(rs: RomSet, k: KofLayout, ch: number, facing: 0 | 1): number | null {
  if (k.commandPtrTable === undefined) return null;
  const v = rs.read32(k.commandPtrTable + ch * 16 + facing * 4) & 0xffffff;
  return v > 0 && v < 0x100000 ? v : null;
}

export function commandSlots(rs: RomSet, table: number, max = 16): { slot: number; ptr: number; def: CommandDef }[] {
  const out: { slot: number; ptr: number; def: CommandDef }[] = [];
  for (let i = 0; i < max; i++) {
    const raw = rs.read32(table + i * 4);
    if (raw === 0xffffffff) break;
    const ptr = raw & 0xffffff;
    out.push({ slot: i, ptr, def: parseCommand(rs, ptr) });
  }
  return out;
}

/** Entry of a character's command handler (the code that turns recognised motions into move routines). */
export function handlerFor(rs: RomSet, k: KofLayout, ch: number): number | null {
  if (k.handlerTable === undefined) return null;
  const off = rs.read16(k.handlerTable + ch * 2);
  if (off === 0 || off & 1) return null;
  return (k.handlerTable + off) & 0xffffff;
}

export interface MoveEntry {
  /** where `move.l #routine,($198,a4)` is */
  site: number;
  routine: number;
  /** command slot from btst #bit,(byte,a6): slot = (byte-4)*4 + bit/2, or null when a helper check is used */
  slot: number | null;
  /** button mask tested with andi.b (A=$10 B=$20 C=$40 D=$80), null if not found */
  buttons: number | null;
  /** helper routine called for the check (command normals / special conditions) */
  check?: number;
  kind: "special/super" | "command normal" | "unknown";
  /** handler section: ground, air, or the alternate mode (+$1D6 set) */
  context: "ground" | "air" | "alt ground" | "alt air";
  acts: number[];
  damage: number[];
}

const D2_FIELDS = new Set([0xd2, 0xd4, 0xd6, 0xd8, 0xda, 0xc2, 0xc4, 0xc6, 0x72]);

/** ACT numbers and damage values a move routine sets (follows its code like the routine cloner). */
export function routineInfo(rs: RomSet, routine: number): { acts: number[]; damage: number[] } {
  const acts: number[] = [], damage: number[] = [];
  const r = routineToAsm(rs.reader(0), routine, 0x1000);
  for (const ins of r.insns) {
    let m = ins.mnemonic === "move.w" ? ins.operands.match(/^#\$([0-9A-F]+),\(\$([0-9A-F]+),a4\)$/) : null;
    if (m) {
      const v = parseInt(m[1], 16), d = parseInt(m[2], 16);
      if (D2_FIELDS.has(d) && v < 0x400 && !acts.includes(v)) acts.push(v);
    }
    m = ins.mnemonic === "move.b" ? ins.operands.match(/^#\$([0-9A-F]+),\(\$EF,a4\)$/) : null;
    if (m) {
      const v = parseInt(m[1], 16);
      if (!damage.includes(v)) damage.push(v);
    }
  }
  return { acts, damage };
}

/** Decode a character's command handler into its list of complete moves. */
export function analyzeMoves(rs: RomSet, k: KofLayout, ch: number): MoveEntry[] {
  const start = handlerFor(rs, k, ch);
  if (start === null) return [];
  // handler ends where the next character's handler (or the table) starts
  const all: number[] = [];
  for (let c = 0; c < 40; c++) {
    const h = handlerFor(rs, k, c);
    if (h !== null) all.push(h);
  }
  const end = all.filter((h) => h > start).sort((x, y) => x - y)[0] ?? start + 0x800;
  const rd = rs.reader(0);
  const out: MoveEntry[] = [];
  let lastSlot: number | null = null, lastButtons: number | null = null, lastCheck: number | undefined;
  // section starts: targets of "bne" after btst #1,($E0,a4) (in the air) and tst.b ($1D6,a4) (alternate mode)
  const airStarts: number[] = [];
  let altStart = Infinity;
  let prev = "";
  for (let x = start; x < end; ) {
    const i = disasm(rd, x);
    if (i.kind === "invalid") {
      x += 2;
      continue;
    }
    // only forward branches inside this handler open a section (KOF2002 handlers also branch back to shared code)
    if (i.kind === "cond" && i.target !== undefined && i.mnemonic.startsWith("bne") && i.target > x && i.target < end) {
      if (prev === "air") airStarts.push(i.target);
      if (prev === "alt" && altStart === Infinity) altStart = i.target;
    }
    prev = i.mnemonic === "btst" && i.operands === "#1,($E0,a4)" ? "air" : i.mnemonic === "tst.b" && i.operands === "($1D6,a4)" ? "alt" : "";
    x += i.size;
  }
  const contextOf = (site: number): MoveEntry["context"] => {
    const alt = site >= altStart;
    const air = airStarts.some((t) => site >= t && (alt ? t >= altStart : t < altStart));
    return alt ? (air ? "alt air" : "alt ground") : air ? "air" : "ground";
  };
  let a = start;
  while (a < end) {
    const ins = disasm(rd, a);
    if (ins.kind === "invalid") {
      a += 2;
      continue;
    }
    let m = ins.mnemonic === "btst" ? ins.operands.match(/^#(\d+),\(\$([0-9A-F]+),a6\)$/) : null;
    if (m) {
      const bit = +m[1], byte = parseInt(m[2], 16);
      if (byte >= 4 && byte <= 7 && bit % 2 === 0) {
        lastSlot = (byte - 4) * 4 + bit / 2;
        lastButtons = null;
        lastCheck = undefined;
      }
    }
    m = ins.mnemonic === "andi.b" ? ins.operands.match(/^#\$([0-9A-F]+),d0$/) : null;
    if (m) lastButtons = parseInt(m[1], 16);
    if (ins.kind === "call" && ins.target !== undefined && ins.target < start) {
      lastCheck = ins.target;
      lastSlot = null;
      lastButtons = null;
    }
    m = ins.mnemonic === "move.l" ? ins.operands.match(/^#\$([0-9A-F]+),\(\$198,a4\)$/) : null;
    if (m) {
      const routine = parseInt(m[1], 16);
      // look ahead: which return value (bra $19DF0 -> 1 = special, $19DF4 -> 2 = command normal/super)
      let kind: MoveEntry["kind"] = "unknown";
      let b = a + ins.size;
      for (let i = 0; i < 6; i++) {
        const n = disasm(rd, b);
        if (n.kind === "branch" && n.target !== undefined) {
          const r = disasm(rd, n.target);
          if (r.mnemonic === "moveq") kind = r.operands.startsWith("#$1,") ? "special/super" : "command normal";
          break;
        }
        b += n.size;
      }
      const info = routineInfo(rs, routine);
      out.push({ site: a, routine, slot: lastSlot, buttons: lastButtons, check: lastCheck, kind, context: contextOf(a), acts: info.acts, damage: info.damage });
    }
    a += ins.size;
  }
  return out;
}

export function buttonsText(mask: number | null): string {
  if (mask === null) return "";
  const names = ["A", "B", "C", "D"].filter((_, i) => mask & (0x10 << i));
  return names.join("/");
}

// ---------------- P1 ACT number mapping ----------------

export function p1ActMap(rs: RomSet, k: KofLayout, ch: number, count = 0x100): number[] {
  if (!k.p1ActMap) return [];
  const t = rs.read32(k.p1ActMap + ch * 4) & 0xffffff;
  if (t >= 0x100000) return [];
  return Array.from({ length: count }, (_, i) => rs.read16(t + i * 2));
}
