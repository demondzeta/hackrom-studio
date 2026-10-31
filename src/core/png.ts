// Minimal PNG codec (no DOM): 8-bit indexed writer and an 8-bit RGB/RGBA/indexed reader.
import { unzlibSync, zlibSync } from "fflate";

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(b: Uint8Array) {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Indexed PNG (color type 3). `palette` is [r,g,b] per index, `alpha` an optional alpha per index (tRNS). */
export function encodeIndexedPng(w: number, h: number, indices: Uint8Array, palette: [number, number, number][], alpha?: number[]): Uint8Array {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, 3, 0, 0, 0], 8);
  const raw = new Uint8Array((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(indices.subarray(y * w, y * w + w), y * (w + 1) + 1);
  const parts = [Uint8Array.from(SIG), chunk("IHDR", ihdr), chunk("PLTE", Uint8Array.from(palette.flat()))];
  if (alpha) parts.push(chunk("tRNS", Uint8Array.from(alpha)));
  parts.push(chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array()));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

/** Decode an 8-bit, non-interlaced PNG (gray, RGB, RGBA or indexed) to RGBA. Browsers use canvas instead. */
export function decodePng(png: Uint8Array): { w: number; h: number; data: Uint8ClampedArray } {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8, w = 0, h = 0, type = 0, plte: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (p < png.length) {
    const len = dv.getUint32(p), t = String.fromCharCode(...png.subarray(p + 4, p + 8)), d = png.subarray(p + 8, p + 8 + len);
    if (t === "IHDR") {
      w = dv.getUint32(p + 8);
      h = dv.getUint32(p + 12);
      type = d[9];
      if (d[8] !== 8 || d[12]) throw new Error("only 8-bit non-interlaced PNGs are supported");
    } else if (t === "PLTE") plte = d;
    else if (t === "tRNS") trns = d;
    else if (t === "IDAT") idat.push(d);
    p += 12 + len;
  }
  const bpp = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!bpp) throw new Error("unsupported PNG color type " + type);
  const z = new Uint8Array(idat.reduce((n, x) => n + x.length, 0));
  idat.reduce((o, x) => (z.set(x, o), o + x.length), 0);
  const raw = unzlibSync(z), stride = w * bpp;
  const cur = new Uint8Array(stride), prev = new Uint8Array(stride);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
      cur[i] = (line[i] + pred) & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * bpp;
      if (type === 3) {
        const v = cur[s];
        out.set([plte![v * 3], plte![v * 3 + 1], plte![v * 3 + 2], trns && v < trns.length ? trns[v] : 255], o);
      } else if (type === 0 || type === 4) out.set([cur[s], cur[s], cur[s], type === 4 ? cur[s + 1] : 255], o);
      else out.set([cur[s], cur[s + 1], cur[s + 2], type === 6 ? cur[s + 3] : 255], o);
    }
    prev.set(cur);
  }
  return { w, h, data: out };
}
