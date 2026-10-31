// Tutorial example edits for KOF97. Each one was built with this code and checked in FBNeo
// from a savestate (Kyo vs Iori); scripts/fbneoExamples.ts runs the same functions.
import { applyHook, findFreeSpace, planHook } from "../core/analysis";
import { decodeCTile, decodeSTile, encodeSTile, cPairs, ngToRgb, readPalette, rgbToNg, writeCTile } from "../core/gfx";
import { decodePng } from "../core/png";
import { applyFrameImport, frameToPng, planFrameImport, readFrame } from "../games/framePng";
import { assemble } from "../core/m68k/asm";
import { routineToAsm } from "../core/relocate";
import type { RomSet } from "../core/romset";
import { ActCmd, actPointer, decodeSpriteDef, graphEntry, imageTableFor, kofBanks, parseAct, parseCommand, serializeAct, serializeCommand } from "../games/kofEngine";
import { detectProfile } from "../games/profiles";
import { tr } from "../i18n";

export type ExampleId = "palette" | "tiles" | "act" | "command" | "routine" | "hook" | "fix" | "hitbox" | "cancel" | "invincible" | "armor" | "effect" | "active" | "framepng";

const KYO = 0;
const hx = (n: number) => "$" + n.toString(16).toUpperCase();

function ctx(rs: RomSet) {
  const k = detectProfile(rs).kof;
  if (!k) throw new Error("These examples need a KOF97 set");
  const banks = kofBanks(rs, k);
  if (!banks) throw new Error("P2 banks not found");
  return { k, banks };
}

/** Free space in P1 for new code, starting at or after `from` when possible. */
function freeP1(rs: RomSet, need: number, from = 0xf0000): number {
  const p1 = rs.files[rs.p1];
  const runs = findFreeSpace(p1.data, need + 32, rs.p1FixedOffset, rs.p1FixedOffset + 0x100000).map((f) => ({ ...f, addr: f.offset - rs.p1FixedOffset }));
  const inside = runs.find((r) => from >= r.addr && from + need <= r.addr + r.length);
  if (inside) return from;
  const after = runs.filter((r) => r.addr >= from && r.length >= need).sort((x, y) => x.addr - y.addr)[0];
  const pick = after ?? runs[0];
  if (!pick) throw new Error("no free space in P1");
  return pick.addr;
}

/** Rewrite one of Kyo's ACT scripts in place (same size). */
function editAct(rs: RomSet, act: number, label: string, fn: (c: ActCmd, frameNo: number) => ActCmd): string {
  const { k, banks } = ctx(rs);
  const p = actPointer(rs, k, banks.actBank, KYO, act);
  const s = parseAct(rs, banks.actBank, p.addr);
  let frameNo = -1;
  const cmds = s.cmds.map((c) => {
    if (c.t === "frame") frameNo++;
    return fn({ ...c } as ActCmd, frameNo);
  });
  const bytes = serializeAct(cmds);
  if (bytes.length !== s.size) throw new Error("script size changed");
  rs.writeCpu(s.addr, bytes, banks.actBank, label);
  return hx(s.addr);
}

const isAttack = (c: ActCmd) => c.t === "box" && ((c.type & 0xff) >> 2) >= 12 && ((c.type & 0xff) >> 2) <= 55;

export const EXAMPLES: Record<ExampleId, (rs: RomSet) => string> = {
  palette: (rs) => {
    const { banks } = ctx(rs);
    const addr = 0x2d1ff0;
    const before = readPalette(rs, addr, banks.actBank);
    const after = before.map((w, i) => {
      if (i < 7 || i > 12) return w;
      const t = (i - 6) / 6;
      return rgbToNg(20 + 40 * t, 50 + 80 * t, 140 + 110 * t);
    });
    rs.writeCpu(addr, after.flatMap((w) => [w >> 8, w & 255]), banks.actBank, "tutorial: Kyo jacket blue");
    return tr("Kyo A palette at {addr} (bank {bank}): colors 7-12 set to blues", { addr: hx(addr), bank: banks.actBank });
  },

  tiles: (rs) => {
    const { k, banks } = ctx(rs);
    const pairs = cPairs(rs);
    const table = imageTableFor(rs, k, banks.imageBank, KYO);
    if (!table) throw new Error("image table not found");
    let n = 0;
    rs.batch("tutorial: mark Kyo idle tiles", () => {
      for (const id of [0, 1, 2, 3, 4, 5]) {
        const g = graphEntry(rs, k, banks.graphBank, KYO, id);
        const def = decodeSpriteDef(rs, banks.imageBank, rs.read32(table + g.image * 4, banks.imageBank), "masked");
        for (const cell of [def.cols * 2 + 1, def.cols * 2 + 2, def.cols * 3 + 1, def.cols * 3 + 2]) {
          const t = def.cells[cell];
          if (t === undefined || t < 0) continue;
          const px = decodeCTile(rs, pairs, t);
          for (let i = 0; i < 16; i++) {
            px[i * 16 + i] = 1;
            px[i * 16 + 15 - i] = 1;
            px[i * 16 + 7] = px[i * 16 + 8] = 1;
          }
          writeCTile(rs, pairs, t, px, "tile");
          n++;
        }
      }
    });
    return tr("drew white marks on {n} tiles of Kyo's idle frames (image ids 0-5)", { n });
  },

  act: (rs) => {
    const { k, banks } = ctx(rs);
    const p = actPointer(rs, k, banks.actBank, KYO, 0);
    const s = parseAct(rs, banks.actBank, p.addr);
    const cmds = s.cmds.map((c) => {
      if (c.t === "frame") return { ...c, frameId: 0xe3 };
      if (c.t === "box" && (c.type & 3) === 1) return { ...c, w: 40, h: 50 };
      return c;
    });
    rs.writeCpu(s.addr, serializeAct(cmds), banks.actBank, "tutorial: Kyo idle ACT");
    return tr("ACT 000 (idle) at {addr}: every frame shows image $E3, box slot 1 enlarged to 40x50", { addr: hx(s.addr) });
  },

  command: (rs) => {
    const ptr = rs.read32(0xa6e38 + 5 * 4) & 0xffffff;
    const d = parseCommand(rs, ptr);
    if (d.empty || d.steps.length !== 4) throw new Error(`unexpected definition at ${hx(ptr)}`);
    const nd = { ...d, steps: [{ mode: 0x14, input: 0x02 }, { mode: 0x14, input: 0x02 }, { mode: 0x14, input: 0x02 }, { mode: 0x04, input: 0xf0 }] };
    rs.writeCpu(ptr, serializeCommand(nd), 0, "tutorial: Oniyaki = down + button");
    return tr("Kyo slot 5 definition at {addr} (Oniyaki, facing right): down, down, down, any button", { addr: hx(ptr) });
  },

  routine: (rs) => {
    const r = routineToAsm(rs.reader(0), 0x2fcf0);
    let n = 0;
    const src = r.source.replace(/move\.b\s+#\$[0-9A-F]+,\(\$EF,a4\)/g, () => (n++, "move.b   #$60,($EF,a4)"));
    const probe = assemble(src, 0xf0400);
    if (probe.errors.length) throw new Error(probe.errors.map((e) => e.message).join("; "));
    const org = freeP1(rs, probe.bytes.length, 0xf0400);
    const res = assemble(src, org);
    if (res.errors.length) throw new Error(res.errors.map((e) => e.message).join("; "));
    const entry = res.labels["l_02fcf0"];
    rs.batch("tutorial: clone Oniyaki with more damage", () => {
      rs.writeCpu(org, res.bytes, 0, "routine");
      rs.writeCpu(0x19f1c, [(entry >>> 24) & 255, (entry >>> 16) & 255, (entry >>> 8) & 255, entry & 255], 0, "repoint");
    });
    return tr("cloned Oniyaki ($2FCF0, {n} instructions) to {org} with {d} damage writes set to $60; $19F1A now starts {entry}", { n: r.insns.length, org: hx(org), d: n, entry: hx(entry) });
  },

  hook: (rs) => {
    const at = freeP1(rs, 64, 0xf0000);
    const plan = planHook(rs, 0x9c44, at, "    move.b   #$60,$10A83A\n", true);
    if (!plan.ok) throw new Error(plan.errors.join("; "));
    applyHook(rs, plan);
    return tr("main loop hook at $9C44 -> {addr}: timer forced to 60 every frame", { addr: hx(at) });
  },

  fix: (rs) => {
    const s = rs.filesByRole("s")[0];
    if (!s) throw new Error("no S ROM");
    rs.batch("tutorial: mirror HUD font", () => {
      for (let t = 0x300; t < 0x400; t++) {
        const px = decodeSTile(s.f.data, t);
        const f = new Uint8Array(64);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) f[y * 8 + x] = px[y * 8 + 7 - x];
        rs.write(s.i, t * 32, encodeSTile(f), "fix");
      }
    });
    return tr("mirrored fix tiles $300-$3FF (font and CREDITS text)");
  },

  // Kyo far A (ACT $51): attack box half-width 28 -> 120; reach = abs(x) + w = 156 px, the fighters start 160 px apart
  hitbox: (rs) => {
    const at = editAct(rs, 0x51, "tutorial: far A long hitbox", (c) => (isAttack(c) && c.t === "box" ? { ...c, w: 120 } : c));
    return tr("far A (ACT $51 at {addr}): attack box half-width 28 -> 120 (reach 36+120 = 156 px)", { addr: at });
  },

  // Kyo 88 Shiki (ACT $B5, d+fwd+D): attack frames become cancelable into specials/supers (cancel nibble 4)
  cancel: (rs) => {
    let n = 0;
    const at = editAct(rs, 0xb5, "tutorial: 88 Shiki cancelable", (c) => {
      if (c.t === "frame" && (c.effect & 0x0f) === 4) {
        n++;
        return { ...c, cancel: (c.cancel & 0xf0) | 0x04 };
      }
      return c;
    });
    return tr("88 Shiki (ACT $B5 at {addr}): {n} attack frames cancel byte -> x4 (special/super cancel)", { addr: at, n });
  },

  // 88 Shiki: no hurt boxes on any frame (only the attack slot 0 stays selected) = fully invincible
  invincible: (rs) => {
    let n = 0;
    const at = editAct(rs, 0xb5, "tutorial: 88 Shiki invincible", (c) => {
      if (c.t === "frame") {
        n++;
        return { ...c, select: c.select & 0xf1 };
      }
      return c;
    });
    return tr("88 Shiki (ACT $B5 at {addr}): {n} frames keep only box slot 0 (attack) = no hurt boxes", { addr: at, n });
  },

  // Armor: while P1 plays 88 Shiki (P1 ACT code $B5) set the opponent's +$E6 bit 0 (hits deal damage but no hitstun)
  armor: (rs) => {
    const at = freeP1(rs, 96, 0xf0000);
    const code = [
      "    cmpi.w   #$B5,$108172       ; P1 ACT code = 88 Shiki?",
      "    bne.s    .off",
      "    ori.b    #$01,$1083E6       ; P2 +$E6 bit 0: P2's hits cause no hitstun (armor for P1)",
      "    bra.s    .done",
      ".off:",
      "    andi.b   #$FE,$1083E6",
      ".done:",
    ].join("\n");
    const plan = planHook(rs, 0x9c44, at, code + "\n", true);
    if (!plan.ok) throw new Error(plan.errors.join("; "));
    applyHook(rs, plan);
    return tr("armor hook at $9C44 -> {addr}: during ACT $B5 P1 takes damage without hit reactions", { addr: hx(at) });
  },

  // Far A hits with the electric effect (effect high nibble 4)
  effect: (rs) => {
    const at = editAct(rs, 0x51, "tutorial: far A electric", (c) => (c.t === "frame" && (c.select & 1) && c.cancel ? { ...c, effect: (c.effect & 0x0f) | 0x40 } : c));
    EXAMPLES.hitbox(rs);
    return tr("far A (ACT $51 at {addr}): attack frame effect -> $4x (electric), plus the long hitbox so it reaches", { addr: at });
  },

  // Far A punch frame (image $3D): export it to PNG, paint a white sash across the body, import it back into its tiles
  framepng: (rs) => {
    const { k, banks } = ctx(rs);
    const pairs = cPairs(rs);
    const table = imageTableFor(rs, k, banks.imageBank, KYO);
    if (!table) throw new Error("image table not found");
    const g = graphEntry(rs, k, banks.graphBank, KYO, 0x3d);
    const def = decodeSpriteDef(rs, banks.imageBank, rs.read32(table + g.image * 4, banks.imageBank) & 0xffffff, "masked");
    const pal = readPalette(rs, 0x2d1ff0, banks.actBank);
    const img = readFrame(rs, pairs, def);
    const png = decodePng(frameToPng(img, pal));
    const [r, gr, b] = ngToRgb(pal[1]);
    for (let y = 0; y < png.h; y++)
      for (let x = 0; x < png.w; x++) {
        const o = (y * png.w + x) * 4;
        if (png.data[o + 3] >= 128 && Math.abs(x + y - (png.w + png.h) / 2) < 5) png.data.set([r, gr, b, 255], o);
      }
    const plan = planFrameImport(rs, pairs, img, png, pal);
    applyFrameImport(rs, pairs, plan, "tutorial: Kyo far A frame PNG");
    return tr("far A punch (image {img}, def {def}, {c}×{r} cells): white sash imported into {t} of its tiles ({px} pixels)", { img: hx(g.image), def: hx(def.addr), c: def.cols, r: def.rows, t: plan.tiles.size, px: plan.changedPixels });
  },

  // Far A attack frame stays active for 24 frames instead of 3
  active: (rs) => {
    const at = editAct(rs, 0x51, "tutorial: far A long active", (c) => (c.t === "frame" && (c.select & 1) && c.cancel ? { ...c, dur: 24 } : c));
    return tr("far A (ACT $51 at {addr}): attack frame duration 3 -> 24", { addr: at });
  },
};
