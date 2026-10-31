// Small byte / number helpers shared across the app.

export const hex = (n: number, width = 0): string => {
  const s = (n >>> 0).toString(16).toUpperCase();
  return width ? s.padStart(width, "0") : s;
};

export const hex2 = (n: number) => hex(n & 0xff, 2);
export const hex4 = (n: number) => hex(n & 0xffff, 4);
export const hex6 = (n: number) => hex(n & 0xffffff, 6);
export const hex8 = (n: number) => hex(n >>> 0, 8);

export const s8 = (v: number) => ((v & 0xff) ^ 0x80) - 0x80;
export const s16 = (v: number) => ((v & 0xffff) ^ 0x8000) - 0x8000;
export const s32 = (v: number) => v | 0;

export const rd8 = (b: Uint8Array, o: number) => b[o] ?? 0;
export const rd16 = (b: Uint8Array, o: number) => (((b[o] ?? 0) << 8) | (b[o + 1] ?? 0)) & 0xffff;
export const rd32 = (b: Uint8Array, o: number) =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;

export const wr16 = (b: Uint8Array, o: number, v: number) => {
  b[o] = (v >> 8) & 0xff;
  b[o + 1] = v & 0xff;
};
export const wr32 = (b: Uint8Array, o: number, v: number) => {
  b[o] = (v >>> 24) & 0xff;
  b[o + 1] = (v >>> 16) & 0xff;
  b[o + 2] = (v >>> 8) & 0xff;
  b[o + 3] = v & 0xff;
};

export const be16 = (v: number) => [(v >> 8) & 0xff, v & 0xff];
export const be32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

/** Parse "0x1234", "$1234", "1234h" or plain hex ("1234"). Decimal needs a "#" prefix or "d" suffix. */
export function parseNum(text: string): number | null {
  let t = text.trim().replace(/_/g, "");
  if (!t) return null;
  let neg = false;
  if (t.startsWith("-")) {
    neg = true;
    t = t.slice(1);
  }
  let v: number;
  if (/^#?\d+d$/i.test(t)) v = parseInt(t.replace(/^#/, "").slice(0, -1), 10);
  else if (/^#\d+$/.test(t)) v = parseInt(t.slice(1), 10);
  else if (/^(0x|\$)[0-9a-f]+$/i.test(t)) v = parseInt(t.replace(/^(0x|\$)/i, ""), 16);
  else if (/^[0-9a-f]+h$/i.test(t)) v = parseInt(t.slice(0, -1), 16);
  else if (/^[0-9a-f]+$/i.test(t)) v = parseInt(t, 16);
  else return null;
  if (Number.isNaN(v)) return null;
  return neg ? -v : v;
}

/** Parse a hex byte string like "4E 71 4E75" into bytes. */
export function parseHexBytes(text: string): Uint8Array | null {
  const clean = text.replace(/0x/gi, "").replace(/[^0-9a-f]/gi, "");
  if (clean.length % 2) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export const bytesToHex = (b: ArrayLike<number>, sep = " ") =>
  Array.from(b, (x) => hex2(x)).join(sep);

let crcTable: Uint32Array | null = null;
/** crcTable index whose top byte is n (the top bytes are all distinct), used to run CRC32 backwards */
let crcRev: Uint8Array | null = null;
function crcTables() {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    crcRev = new Uint8Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
      crcRev[c >>> 24] = n;
    }
  }
  return { t: crcTable, rev: crcRev! };
}

export function crc32(data: Uint8Array): number {
  const { t } = crcTables();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = t[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Overwrite the 4 bytes at `pos` (in place) so that crc32(data) === target. */
export function forceCrc32(data: Uint8Array, pos: number, target: number) {
  const { t, rev } = crcTables();
  // register before the 4 bytes
  let before = 0xffffffff;
  for (let i = 0; i < pos; i++) before = t[(before ^ data[i]) & 0xff] ^ (before >>> 8);
  // register needed after the 4 bytes: run the tail backwards from the target
  let r = (target ^ 0xffffffff) >>> 0;
  for (let i = data.length - 1; i >= pos + 4; i--) {
    const k = rev[r >>> 24];
    r = (((r ^ t[k]) << 8) | (k ^ data[i])) >>> 0;
  }
  // 4 bytes w from register s give the same result as 4 zero bytes from s ^ w, so undo 4 zero steps
  for (let n = 0; n < 4; n++) {
    const k = rev[r >>> 24];
    r = (((r ^ t[k]) << 8) | k) >>> 0;
  }
  const w = (r ^ before) >>> 0;
  for (let n = 0; n < 4; n++) data[pos + n] = (w >>> (8 * n)) & 0xff;
}

export function swap16(src: Uint8Array): Uint8Array {
  const out = new Uint8Array(src.length);
  for (let i = 0; i + 1 < src.length; i += 2) {
    out[i] = src[i + 1];
    out[i + 1] = src[i];
  }
  if (src.length & 1) out[src.length - 1] = src[src.length - 1];
  return out;
}

export function downloadBlob(data: BlobPart, filename: string, type = "application/octet-stream") {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
