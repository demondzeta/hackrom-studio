// Render sprite images of a character (by image index) to one PNG: node .ri.cjs kof97.zip out.png ch img,img,...
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { deflateSync } from "node:zlib";
import { RomSet } from "../src/core/romset";
import { detectProfile } from "../src/games/profiles";
import { kofBanks, imageTableFor, decodeSpriteDef } from "../src/games/kofEngine";
import { cPairs, decodeCTile } from "../src/core/gfx";
const z = unzipSync(readFileSync(process.argv[2]));
const rs = RomSet.fromFiles("k", Object.entries(z).map(([name, data]) => ({ name, data })));
const k = detectProfile(rs).kof!; const b = kofBanks(rs, k)!; const pairs = cPairs(rs);
const ch = parseInt(process.argv[4], 16), ims = process.argv[5].split(",").map((x) => parseInt(x, 16));
const it = imageTableFor(rs, k, b.graphBank, ch)!;
const defs = ims.map((im) => decodeSpriteDef(rs, b.graphBank, rs.read32(it + im * 4, b.graphBank), "masked"));
const W = defs.reduce((a, d) => a + d.cols * 16 + 8, 0), H = Math.max(...defs.map((d) => d.rows * 16));
const img = Buffer.alloc(W * H * 3, 40); const buf = new Uint8Array(256); let ox = 0;
for (const d of defs) { d.cells.forEach((t, i) => { if (t < 0) return; decodeCTile(rs, pairs, t, buf); const cx = (i % d.cols) * 16, cy = Math.floor(i / d.cols) * 16; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const v = buf[y * 16 + x]; if (!v) continue; const o = ((cy + y) * W + ox + cx + x) * 3; img[o] = img[o + 1] = img[o + 2] = 50 + v * 13; } }); ox += d.cols * 16 + 8; console.log("mode", d.mode.toString(16), d.cols + "x" + d.rows, "tiles", d.cells.filter((t) => t >= 0).map((t) => t.toString(16)).slice(0, 8).join(",")); }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let q = 0; q < 8; q++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (x: Buffer) => { let c = -1; for (const v of x) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const S = 2; const raw = Buffer.alloc((W * S * 3 + 1) * H * S);
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) { const s2 = (Math.floor(y / S) * W + Math.floor(x / S)) * 3; img.copy(raw, y * (W * S * 3 + 1) + 1 + x * 3, s2, s2 + 3); }
const ih = Buffer.alloc(13); ih.writeUInt32BE(W * S, 0); ih.writeUInt32BE(H * S, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(process.argv[3], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
