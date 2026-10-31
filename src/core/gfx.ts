// Neo Geo graphics codecs: C-ROM sprite tiles (16x16), S-ROM fix tiles (8x8), palette words.
import type { RomSet } from "./romset";

export type RGBA = [number, number, number, number];

// ---------------- palette words ----------------
// Neo Geo color word: D R0 G0 B0 R4 R3 R2 R1 G4 G3 G2 G1 B4 B3 B2 B1 (D = "dark" bit)

export function ngToRgb(w: number): [number, number, number] {
  const dark = (w >> 15) & 1;
  const r5 = ((w >> 7) & 0x1e) | ((w >> 14) & 1);
  const g5 = ((w >> 3) & 0x1e) | ((w >> 13) & 1);
  const b5 = ((w << 1) & 0x1e) | ((w >> 12) & 1);
  const conv = (c5: number) => Math.round(((c5 * 2 + (dark ? 0 : 1)) * 255) / 63);
  return [conv(r5), conv(g5), conv(b5)];
}

export function rgbToNg(r: number, g: number, b: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (const dark of [0, 1]) {
    const q = (c: number) => Math.max(0, Math.min(31, Math.round(((c * 63) / 255 - (dark ? 0 : 1)) / 2)));
    const r5 = q(r), g5 = q(g), b5 = q(b);
    const w =
      (dark << 15) |
      ((r5 & 1) << 14) |
      ((g5 & 1) << 13) |
      ((b5 & 1) << 12) |
      ((r5 >> 1) << 8) |
      ((g5 >> 1) << 4) |
      (b5 >> 1);
    const [rr, gg, bb] = ngToRgb(w);
    const err = (rr - r) ** 2 + (gg - g) ** 2 + (bb - b) ** 2;
    if (err < bestErr) {
      bestErr = err;
      best = w;
    }
  }
  return best;
}

export const rgbCss = (w: number) => {
  const [r, g, b] = ngToRgb(w);
  return `rgb(${r},${g},${b})`;
};

export const rgbHex = (w: number) => {
  const [r, g, b] = ngToRgb(w);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
};

export function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.replace("#", ""), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Turn 16 palette words into RGBA entries. Index 0 is transparent for sprites. */
export function paletteRgba(words: number[], transparent0 = true): RGBA[] {
  return words.map((w, i) => {
    const [r, g, b] = ngToRgb(w);
    return [r, g, b, i === 0 && transparent0 ? 0 : 255] as RGBA;
  });
}

/** A neutral grey ramp used when no palette is chosen. */
export const GREY_PALETTE: number[] = Array.from({ length: 16 }, (_, i) => {
  if (i === 0) return 0x8000;
  const v = Math.round((i / 15) * 31);
  return rgbToNg((v * 255) / 31, (v * 255) / 31, (v * 255) / 31);
});

/** A high contrast "debug" palette that shows every index clearly. */
export const DEBUG_PALETTE: number[] = [
  "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
  "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa",
].map((h) => rgbToNg(...hexToRgb(h)));

// ---------------- C ROM sprite tiles ----------------

export interface CPair {
  odd: number; // file index of c1/c3/... (bitplanes 0,1)
  even: number; // file index of c2/c4/... (bitplanes 2,3)
  firstTile: number;
  tiles: number;
}

export function cPairs(rs: RomSet): CPair[] {
  const cs = rs.filesByRole("c").sort((a, b) => a.f.num - b.f.num);
  const pairs: CPair[] = [];
  let first = 0;
  for (let i = 0; i + 1 < cs.length; i += 2) {
    const odd = cs[i], even = cs[i + 1];
    const tiles = Math.floor(Math.min(odd.f.data.length, even.f.data.length) / 64);
    pairs.push({ odd: odd.i, even: even.i, firstTile: first, tiles });
    first += tiles;
  }
  return pairs;
}

export function totalCTiles(pairs: CPair[]) {
  const last = pairs[pairs.length - 1];
  return last ? last.firstTile + last.tiles : 0;
}

export function locateCTile(pairs: CPair[], tile: number): { pair: CPair; local: number; offset: number } | null {
  for (const p of pairs)
    if (tile >= p.firstTile && tile < p.firstTile + p.tiles) {
      const local = tile - p.firstTile;
      return { pair: p, local, offset: local * 64 };
    }
  return null;
}

// block order inside a tile: up-right, down-right, up-left, down-left
const BLOCK_X = [8, 8, 0, 0];
const BLOCK_Y = [0, 8, 0, 8];

/** Decode one 16x16 sprite tile into 256 palette indices (row-major). */
export function decodeCTile(rs: RomSet, pairs: CPair[], tile: number, out = new Uint8Array(256)): Uint8Array {
  out.fill(0);
  const loc = locateCTile(pairs, tile);
  if (!loc) return out;
  const c1 = rs.files[loc.pair.odd].data;
  const c2 = rs.files[loc.pair.even].data;
  let o = loc.offset;
  for (let blk = 0; blk < 4; blk++) {
    for (let row = 0; row < 8; row++, o += 2) {
      const p0 = c1[o], p1 = c1[o + 1], p2 = c2[o], p3 = c2[o + 1];
      const y = BLOCK_Y[blk] + row;
      for (let b = 0; b < 8; b++) {
        const v = ((p0 >> b) & 1) | (((p1 >> b) & 1) << 1) | (((p2 >> b) & 1) << 2) | (((p3 >> b) & 1) << 3);
        out[y * 16 + BLOCK_X[blk] + b] = v;
      }
    }
  }
  return out;
}

/** Encode 256 indices back to the c-odd / c-even 64 byte halves. */
export function encodeCTile(pixels: Uint8Array): { odd: Uint8Array; even: Uint8Array } {
  const odd = new Uint8Array(64);
  const even = new Uint8Array(64);
  let o = 0;
  for (let blk = 0; blk < 4; blk++) {
    for (let row = 0; row < 8; row++, o += 2) {
      let p0 = 0, p1 = 0, p2 = 0, p3 = 0;
      const y = BLOCK_Y[blk] + row;
      for (let b = 0; b < 8; b++) {
        const v = pixels[y * 16 + BLOCK_X[blk] + b] & 15;
        p0 |= (v & 1) << b;
        p1 |= ((v >> 1) & 1) << b;
        p2 |= ((v >> 2) & 1) << b;
        p3 |= ((v >> 3) & 1) << b;
      }
      odd[o] = p0;
      odd[o + 1] = p1;
      even[o] = p2;
      even[o + 1] = p3;
    }
  }
  return { odd, even };
}

export function writeCTile(rs: RomSet, pairs: CPair[], tile: number, pixels: Uint8Array, label = "tile edit") {
  const loc = locateCTile(pairs, tile);
  if (!loc) throw new Error("tile out of range");
  const { odd, even } = encodeCTile(pixels);
  rs.batch(label, () => {
    rs.write(loc.pair.odd, loc.offset, odd, label);
    rs.write(loc.pair.even, loc.offset, even, label);
  });
}

export function isBlankCTile(rs: RomSet, pairs: CPair[], tile: number) {
  const loc = locateCTile(pairs, tile);
  if (!loc) return false;
  const c1 = rs.files[loc.pair.odd].data, c2 = rs.files[loc.pair.even].data;
  for (let i = 0; i < 64; i++) if (c1[loc.offset + i] || c2[loc.offset + i]) return false;
  return true;
}

/** Find runs of blank (all index 0) tiles, useful as free space for new graphics. */
export function findBlankTileRuns(rs: RomSet, pairs: CPair[], minRun = 64): { start: number; count: number }[] {
  const out: { start: number; count: number }[] = [];
  for (const p of pairs) {
    const c1 = rs.files[p.odd].data, c2 = rs.files[p.even].data;
    let runStart = -1;
    for (let t = 0; t <= p.tiles; t++) {
      // a tile is free when it is all zero (transparent) or all FF (erased flash)
      let blank = t < p.tiles;
      if (blank) {
        const o = t * 64;
        const fill = c1[o];
        if (fill !== 0 && fill !== 0xff) blank = false;
        for (let i = 0; blank && i < 64; i++) if (c1[o + i] !== fill || c2[o + i] !== fill) blank = false;
      }
      if (blank && runStart < 0) runStart = t;
      if (!blank && runStart >= 0) {
        if (t - runStart >= minRun) out.push({ start: p.firstTile + runStart, count: t - runStart });
        runStart = -1;
      }
    }
  }
  return out;
}

// ---------------- S ROM fix tiles ----------------

const FIX_COLS = [4, 6, 0, 2];

export function decodeSTile(data: Uint8Array, tile: number, out = new Uint8Array(64)): Uint8Array {
  const base = tile * 32;
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 8; row++) {
      const v = data[base + c * 8 + row] ?? 0;
      out[row * 8 + FIX_COLS[c]] = v & 15;
      out[row * 8 + FIX_COLS[c] + 1] = v >> 4;
    }
  return out;
}

export function encodeSTile(pixels: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  for (let c = 0; c < 4; c++)
    for (let row = 0; row < 8; row++)
      out[c * 8 + row] = (pixels[row * 8 + FIX_COLS[c]] & 15) | ((pixels[row * 8 + FIX_COLS[c] + 1] & 15) << 4);
  return out;
}

// ---------------- drawing helpers ----------------

export function blitIndexed(
  img: ImageData,
  pixels: Uint8Array,
  size: number,
  pal: RGBA[],
  dx: number,
  dy: number,
  flipX = false,
  flipY = false,
) {
  const W = img.width, H = img.height, d = img.data;
  for (let y = 0; y < size; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= H) continue;
    const sy = flipY ? size - 1 - y : y;
    for (let x = 0; x < size; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= W) continue;
      const sx = flipX ? size - 1 - x : x;
      const c = pal[pixels[sy * size + sx]];
      if (!c || c[3] === 0) continue;
      const o = (ty * W + tx) * 4;
      d[o] = c[0];
      d[o + 1] = c[1];
      d[o + 2] = c[2];
      d[o + 3] = 255;
    }
  }
}

/** Read 16 palette words from a 68k address. */
export function readPalette(rs: RomSet, addr: number, bank = 0): number[] {
  const out: number[] = [];
  for (let i = 0; i < 16; i++) out.push(rs.read16(addr + i * 2, bank));
  return out;
}

/** Quantize RGBA pixels to a 16 color palette (index 0 = transparent). Returns indices. */
export function quantizeToPalette(rgba: Uint8ClampedArray, palWords: number[], alphaThreshold = 128): Uint8Array {
  const pal = palWords.map(ngToRgb);
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2], a = rgba[i * 4 + 3];
    if (a < alphaThreshold) {
      out[i] = 0;
      continue;
    }
    let best = 1, bestErr = Infinity;
    for (let k = 1; k < 16; k++) {
      const e = (pal[k][0] - r) ** 2 * 3 + (pal[k][1] - g) ** 2 * 4 + (pal[k][2] - b) ** 2 * 2;
      if (e < bestErr) {
        bestErr = e;
        best = k;
      }
    }
    out[i] = best;
  }
  return out;
}

/** Build a 15 color palette (plus transparent) from an image using median cut. */
export function buildPaletteFromImage(rgba: Uint8ClampedArray, alphaThreshold = 128): number[] {
  const px: [number, number, number][] = [];
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= alphaThreshold) px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  const boxes: [number, number, number][][] = [px];
  while (boxes.length < 15) {
    let bi = -1, bestRange = -1, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255, hi = 0;
        for (const p of box) {
          lo = Math.min(lo, p[ch]);
          hi = Math.max(hi, p[ch]);
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo;
          bi = i;
          bestCh = ch;
        }
      }
    });
    if (bi < 0 || bestRange <= 0) break;
    const box = boxes[bi].sort((a, b) => a[bestCh] - b[bestCh]);
    const mid = box.length >> 1;
    boxes.splice(bi, 1, box.slice(0, mid), box.slice(mid));
  }
  const cols = boxes
    .filter((b) => b.length)
    .map((b) => {
      const s = b.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
      return rgbToNg(s[0] / b.length, s[1] / b.length, s[2] / b.length);
    });
  // sort dark -> light for nicer palettes
  cols.sort((a, b) => {
    const la = ngToRgb(a).reduce((x, y) => x + y, 0), lb = ngToRgb(b).reduce((x, y) => x + y, 0);
    return la - lb;
  });
  while (cols.length < 15) cols.push(0);
  return [0x8000, ...cols.slice(0, 15)];
}
