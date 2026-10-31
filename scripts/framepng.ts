// Round-trips a KOF frame through PNG on a real set (read only): node .fp.cjs kof97.zip outdir [ch] [act] [frame]
// 1) export -> import unchanged must write nothing; 2) a visible edit must only change that frame's tiles.
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { RomSet } from "../src/core/romset";
import { cPairs, locateCTile, ngToRgb, readPalette } from "../src/core/gfx";
import { decodePng } from "../src/core/png";
import { detectProfile } from "../src/games/profiles";
import { actFrames, actPointer, decodeSpriteDef, graphEntry, imageTableFor, kofBanks, parseAct, scanImageTables } from "../src/games/kofEngine";
import { applyFrameImport, frameToPng, planFrameImport, readFrame, sharedTiles } from "../src/games/framePng";

const [, , src, outDir, chArg = "0", actArg = "0", frameArg = "0"] = process.argv;
const z = unzipSync(readFileSync(src));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
const k = detectProfile(rs).kof!, b = kofBanks(rs, k)!, pairs = cPairs(rs);
const ch = parseInt(chArg, 16), act = parseInt(actArg, 16);
const frames = actFrames(parseAct(rs, b.actBank, actPointer(rs, k, b.actBank, ch, act).addr));
const f = frames[+frameArg];
const g = graphEntry(rs, k, b.graphBank, ch, f.cmd.frameId);
const table = imageTableFor(rs, k, b.graphBank, ch)!;
const def = decodeSpriteDef(rs, b.graphBank, rs.read32(table + g.image * 4, b.graphBank) & 0xffffff, "masked");
const pal = readPalette(rs, 0x2d1ff0, b.actBank);
const used = def.cells.filter((t) => t >= 0);
const count = scanImageTables(rs, b.graphBank).find((t) => t.addr === table)?.count ?? 0;
const sh = sharedTiles(rs, b.graphBank, table, count, g.image, used);
console.log(`ch ${ch} ACT ${act.toString(16)} frame ${frameArg}: id $${f.cmd.frameId.toString(16)} image $${g.image.toString(16)} def $${def.addr.toString(16)} type ${def.mode & 0xff} ${def.cols}x${def.rows}, ${used.length}/${def.cells.length} cells have tiles (${new Set(used).size} distinct), ${sh.tiles} shared with ${sh.images.length} other images`);

const cBytes = () => rs.files.filter((x) => x.role === "c").map((x) => x.data.slice());
const before = cBytes();
const diff = (a: Uint8Array[], b2: Uint8Array[]) => a.reduce((n, x, i) => n + x.reduce((m, v, j) => m + (v !== b2[i][j] ? 1 : 0), 0), 0);

// 1) unchanged round trip, through an actual PNG file
const img = readFrame(rs, pairs, def);
const file = `${outDir}/frame-export.png`;
writeFileSync(file, frameToPng(img, pal));
const back = decodePng(readFileSync(file));
const p0 = planFrameImport(rs, pairs, img, back, pal);
applyFrameImport(rs, pairs, p0, "roundtrip");
console.log(`unchanged import: error ${p0.error ?? "none"}, tiles to write ${p0.tiles.size}, changed px ${p0.changedPixels}, C-ROM byte diff ${diff(before, cBytes())}`);

// 2) visible edit: a white diagonal sash across the body + a blob outside the definition's tiles
const [wr, wg, wb] = ngToRgb(pal[1]);
const e = { ...back, data: back.data.slice() };
let painted = 0;
for (let y = 0; y < e.h; y++)
  for (let x = 0; x < e.w; x++) {
    const o = (y * e.w + x) * 4;
    if (e.data[o + 3] >= 128 && Math.abs(x + y - (e.w + e.h) / 2) < 5) e.data.set([wr, wg, wb, 255], o), painted++;
  }
const emptyCell = def.cells.findIndex((t) => t < 0);
if (emptyCell >= 0) {
  const ox = (emptyCell % def.cols) * 16, oy = Math.floor(emptyCell / def.cols) * 16;
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) e.data.set([wr, wg, wb, 255], ((oy + y) * e.w + ox + x) * 4);
}
const p1 = planFrameImport(rs, pairs, img, e, pal);
applyFrameImport(rs, pairs, p1, "edit");
const after = cBytes();
// every changed byte must be inside one of the frame's tiles
const allowed = new Set(used.map((t) => `${locateCTile(pairs, t)!.pair.odd}:${locateCTile(pairs, t)!.local}`));
let outsideBytes = 0;
const cFiles = rs.files.map((x, i) => ({ x, i })).filter(({ x }) => x.role === "c");
cFiles.forEach(({ i }, n) => {
  const pair = pairs.find((p) => p.odd === i || p.even === i)!;
  for (let j = 0; j < after[n].length; j++) if (after[n][j] !== before[n][j] && !allowed.has(`${pair.odd}:${j >> 6}`)) outsideBytes++;
});
console.log(`edit: painted ${painted} px, tiles written ${p1.tiles.size}, changed px ${p1.changedPixels}, outside px ${p1.outsidePixels} in ${p1.outsideCells} empty cell(s), conflicts ${p1.conflicts}, C-ROM bytes changed ${diff(before, after)}, outside the frame's tiles ${outsideBytes}`);
writeFileSync(`${outDir}/frame-edited-input.png`, encodeRgba(e));
writeFileSync(`${outDir}/frame-after.png`, frameToPng(readFrame(rs, pairs, def), pal));

function encodeRgba(im: { w: number; h: number; data: Uint8ClampedArray }) {
  // reuse the indexed writer: map the RGBA back to palette indices for a quick look
  const idx = new Uint8Array(im.w * im.h);
  const cols = pal.map(ngToRgb);
  for (let i = 0; i < idx.length; i++) {
    if (im.data[i * 4 + 3] < 128) continue;
    idx[i] = Math.max(0, cols.findIndex((c, n) => n && c[0] === im.data[i * 4] && c[1] === im.data[i * 4 + 1] && c[2] === im.data[i * 4 + 2]));
  }
  return frameToPng({ def, w: im.w, h: im.h, px: idx, inside: new Uint8Array(idx.length).fill(1) }, pal);
}
