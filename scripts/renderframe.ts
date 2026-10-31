// Render a KOF frame from a real set to PNG to validate sprite decoding: node .rf.cjs kof97.zip out.png ch frameId
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { RomSet } from "../src/core/romset";
import { detectProfile } from "../src/games/profiles";
import { kofBanks, graphEntry, decodeSpriteDef } from "../src/games/kofEngine";
import { cPairs, decodeCTile, ngToRgb, readPalette } from "../src/core/gfx";
import { deflateSync } from "node:zlib";
const z = unzipSync(readFileSync(process.argv[2]));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
const k = detectProfile(rs).kof!; const b = kofBanks(rs, k)!; const pairs = cPairs(rs);
const ch = +(process.argv[4] ?? 0), ids = (process.argv[5] ?? "e1").split(",").map((x) => parseInt(x, 16));
const pal = readPalette(rs, 0x2d1ff0, 2).map(ngToRgb);
const frames = ids.map((id) => { const g = graphEntry(rs, k, b.graphBank, ch, id); const d = decodeSpriteDef(rs, b.graphBank, rs.read32(0x2536c6 + g.image * 4, b.graphBank), "masked"); return d; });
const W = frames.reduce((a, f) => a + f.cols * 16 + 8, 0), H = Math.max(...frames.map((f) => f.rows * 16));
const img = Buffer.alloc(W * H * 3, 40);
let ox = 0; const buf = new Uint8Array(256);
for (const f of frames) { f.cells.forEach((t, i) => { if (t < 0) return; decodeCTile(rs, pairs, t, buf); const cx = (i % f.cols) * 16, cy = Math.floor(i / f.cols) * 16; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = buf[y * 16 + x]; if (!v) continue; const o = ((cy + y) * W + ox + cx + x) * 3; img[o] = pal[v][0]; img[o + 1] = pal[v][1]; img[o + 2] = pal[v][2]; } }); ox += f.cols * 16 + 8; }
// minimal PNG writer
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k2 = 0; k2 < 8; k2++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const S = 3; const raw = Buffer.alloc((W * S * 3 + 1) * H * S);
for (let y = 0; y < H * S; y++) { raw[y * (W * S * 3 + 1)] = 0; for (let x = 0; x < W * S; x++) { const s = (Math.floor(y / S) * W + Math.floor(x / S)) * 3; img.copy(raw, y * (W * S * 3 + 1) + 1 + x * 3, s, s + 3); } }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W * S, 0); ihdr.writeUInt32BE(H * S, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(process.argv[3], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(frames.map((f) => `${f.cols}x${f.rows} base ${f.baseTile.toString(16)} raw ${f.raw.slice(0, 14).map((x) => x.toString(16).padStart(2, "0")).join(" ")}`).join("\n"));
