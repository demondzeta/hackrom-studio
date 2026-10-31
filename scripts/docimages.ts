// Renders documentation strips of KOF97 animations (sprite + boxes, training mode colors) from a ROM.
// usage: node .di.cjs kof97.zip outdir
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { deflateSync } from "node:zlib";
import { RomSet } from "../src/core/romset";
import { detectProfile, TM_BOX_COLORS, tmBoxKind } from "../src/games/profiles";
import { actFrames, actPointer, decodeSpriteDef, graphEntry, imageTableFor, kofBanks, parseAct } from "../src/games/kofEngine";
import { cPairs, decodeCTile, ngToRgb, readPalette } from "../src/core/gfx";

const [, , src, outDir] = process.argv;
const z = unzipSync(readFileSync(src));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
const k = detectProfile(rs).kof!;
const banks = kofBanks(rs, k)!;
const pairs = cPairs(rs);
const pal = readPalette(rs, 0x2d1ff0, banks.actBank).map(ngToRgb);

function png(file: string, W: number, H: number, rgb: Buffer, S = 2) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let q = 0; q < 8; q++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (x: Buffer) => { let c = -1; for (const v of x) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((W * S * 3 + 1) * H * S);
  for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) { const s2 = (Math.floor(y / S) * W + Math.floor(x / S)) * 3; rgb.copy(raw, y * (W * S * 3 + 1) + 1 + x * 3, s2, s2 + 3); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W * S, 0); ih.writeUInt32BE(H * S, 4); ih[8] = 8; ih[9] = 2;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const hexc = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** One panel per frame: sprite facing right, boxes of the active slots (inactive slots dashed-light). */
function strip(ch: number, act: number, file: string, maxFrames = 12) {
  const p = actPointer(rs, k, banks.actBank, ch, act);
  const frames = actFrames(parseAct(rs, banks.actBank, p.addr)).slice(0, maxFrames);
  const PW = 160, PH = 150, OX = 70, OY = 136, GAP = 4;
  const W = frames.length * (PW + GAP), H = PH;
  const img = Buffer.alloc(W * H * 3);
  for (let i = 0; i < img.length; i += 3) { img[i] = 24; img[i + 1] = 27; img[i + 2] = 36; }
  const put = (x: number, y: number, c: number[], a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3;
    for (let k2 = 0; k2 < 3; k2++) img[o + k2] = Math.round(img[o + k2] * (1 - a) + c[k2] * a);
  };
  const it = imageTableFor(rs, k, banks.graphBank, ch)!;
  const buf = new Uint8Array(256);
  frames.forEach((f, n) => {
    const px0 = n * (PW + GAP);
    for (let x = 0; x < PW; x++) put(px0 + x, OY, [70, 78, 104]);
    for (let y = 0; y < PH; y++) put(px0 + OX, y, [50, 56, 76]);
    const g = graphEntry(rs, k, banks.graphBank, ch, f.cmd.frameId);
    const def = decodeSpriteDef(rs, banks.graphBank, rs.read32(it + g.image * 4, banks.graphBank), "masked");
    const w = def.cols * 16;
    def.cells.forEach((t, i) => {
      if (t < 0) return;
      decodeCTile(rs, pairs, t, buf);
      const cx = (i % def.cols) * 16, cy = Math.floor(i / def.cols) * 16;
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const v = buf[y * 16 + x];
          if (!v) continue;
          // facing right: mirror around the origin
          const sx = OX - (g.x + cx + x) - 1 + 0, sy = OY + g.y + cy + y;
          put(px0 + sx, sy, pal[v]);
        }
    });
    void w;
    f.slots.forEach((b, slot) => {
      if (!b) return;
      const active = !!(f.cmd.select & (1 << slot));
      const col = hexc(TM_BOX_COLORS[tmBoxKind(b.type)]);
      const cx = OX - b.x, cy = OY + b.y;
      for (let y = cy - b.h; y < cy + b.h; y++)
        for (let x = cx - b.w; x < cx + b.w; x++) {
          const edge = y === cy - b.h || y === cy + b.h - 1 || x === cx - b.w || x === cx + b.w - 1;
          if (active) put(px0 + x, y, col, edge ? 1 : 0.25);
          else if (edge && (x + y) % 4 < 2) put(px0 + x, y, col, 0.5);
        }
    });
    // duration bar along the top: one tick per frame of duration
    for (let d = 0; d < f.cmd.dur; d++) for (let y = 2; y < 6; y++) for (let x = 0; x < 3; x++) put(px0 + 4 + d * 5 + x, y, [255, 176, 0]);
  });
  png(file, W, H, img, 2);
  return frames.map((f) => ({ id: f.cmd.frameId, dur: f.cmd.dur, effect: f.cmd.effect, sel: f.cmd.select, cancel: f.cmd.cancel, boxes: f.activeBoxes.map((b) => b.type) }));
}

const info = {
  oniyaki: strip(0, 0x80, `${outDir}/kyo-oniyaki-act080.png`),
  farA: strip(0, 0x51, `${outDir}/kyo-farA-act051.png`),
  shiki88: strip(0, 0xb5, `${outDir}/kyo-88shiki-actB5.png`),
};
console.log(JSON.stringify(info));
