// Replace a KOF frame's art in place: export the frame exactly as its sprite definition lays it out
// (per-column row masks), and write an edited PNG back into the SAME tiles. Cells that have no tile in
// the definition can't receive pixels; those are counted and reported instead of being written.
import { CPair, decodeCTile, encodeCTile, locateCTile, ngToRgb, quantizeToPalette } from "../core/gfx";
import { encodeIndexedPng } from "../core/png";
import type { RomSet } from "../core/romset";
import { decodeSpriteDef, SpriteDef } from "./kofEngine";

export interface FrameImage {
  def: SpriteDef;
  w: number;
  h: number;
  /** palette index per pixel (row-major) */
  px: Uint8Array;
  /** 1 where the pixel belongs to a tile of the definition */
  inside: Uint8Array;
}

/** Index used in exported PNGs for pixels outside the frame's tiles: a faint tint, read back as transparent. */
export const OUTSIDE_INDEX = 16;
export const OUTSIDE_RGB: [number, number, number] = [255, 0, 255];
export const OUTSIDE_ALPHA = 48;

export function readFrame(rs: RomSet, pairs: CPair[], def: SpriteDef): FrameImage {
  const w = def.cols * 16, h = def.rows * 16;
  const px = new Uint8Array(w * h), inside = new Uint8Array(w * h);
  const buf = new Uint8Array(256);
  def.cells.forEach((t, i) => {
    if (t < 0) return;
    decodeCTile(rs, pairs, t, buf);
    const ox = (i % def.cols) * 16, oy = Math.floor(i / def.cols) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        px[(oy + y) * w + ox + x] = buf[y * 16 + x];
        inside[(oy + y) * w + ox + x] = 1;
      }
  });
  return { def, w, h, px, inside };
}

/** Indexed PNG of the frame with the given palette: index 0 transparent, outside cells faintly tinted. */
export function frameToPng(img: FrameImage, pal: number[]): Uint8Array {
  const idx = img.px.map((v, i) => (img.inside[i] ? v : OUTSIDE_INDEX));
  const colors = pal.slice(0, 16).map(ngToRgb);
  return encodeIndexedPng(img.w, img.h, idx, [...colors, OUTSIDE_RGB], [0, ...Array(15).fill(255), OUTSIDE_ALPHA]);
}

export interface FrameImportPlan {
  /** new tile pixels, only for tiles that change */
  tiles: Map<number, Uint8Array>;
  changedPixels: number;
  /** opaque pixels drawn where the definition has no tile (ignored) */
  outsidePixels: number;
  outsideCells: number;
  /** pixels where two cells that share one tile were edited differently (first edit kept) */
  conflicts: number;
  /** "size": PNG is not the frame's size; "opaque": the PNG lost its transparency */
  error?: "size" | "opaque";
}

/**
 * Map an RGBA image (same size as the frame) back onto the frame's tiles. Pixels whose color still equals
 * the original pixel's palette color keep their index, so an unedited export imports with zero changes even
 * when the palette has duplicate colors. Other pixels are matched to the nearest palette color (alpha < 128 = 0).
 */
export function planFrameImport(rs: RomSet, pairs: CPair[], img: FrameImage, rgba: { w: number; h: number; data: Uint8ClampedArray }, pal: number[]): FrameImportPlan {
  const plan: FrameImportPlan = { tiles: new Map(), changedPixels: 0, outsidePixels: 0, outsideCells: 0, conflicts: 0 };
  if (rgba.w !== img.w || rgba.h !== img.h) {
    plan.error = "size";
    return plan;
  }
  // an editor that dropped the alpha channel would turn every transparent pixel into a color
  let opaque = true;
  for (let i = 3; opaque && i < rgba.data.length; i += 4) if (rgba.data[i] < 128) opaque = false;
  if (opaque && img.px.some((v, i) => img.inside[i] && !v)) {
    plan.error = "opaque";
    return plan;
  }
  const colors = pal.map(ngToRgb);
  const nearest = quantizeToPalette(rgba.data, pal);
  const want = new Uint8Array(img.w * img.h);
  for (let i = 0; i < want.length; i++) {
    const r = rgba.data[i * 4], g = rgba.data[i * 4 + 1], b = rgba.data[i * 4 + 2], a = rgba.data[i * 4 + 3];
    const o = img.px[i], c = colors[o];
    want[i] = a < 128 ? 0 : o && c[0] === r && c[1] === g && c[2] === b ? o : nearest[i];
  }
  // pixels outside the definition's tiles
  img.def.cells.forEach((t, i) => {
    if (t >= 0) return;
    const ox = (i % img.def.cols) * 16, oy = Math.floor(i / img.def.cols) * 16;
    let n = 0;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (want[(oy + y) * img.w + ox + x]) n++;
    plan.outsidePixels += n;
    if (n) plan.outsideCells++;
  });
  // merge per tile: a cell only contributes the pixels it changed (a tile may appear in several cells)
  const merged = new Map<number, { orig: Uint8Array; next: Uint8Array; set: Uint8Array }>();
  img.def.cells.forEach((t, i) => {
    if (t < 0 || !locateCTile(pairs, t)) return;
    let m = merged.get(t);
    if (!m) {
      const orig = decodeCTile(rs, pairs, t);
      m = { orig, next: orig.slice(), set: new Uint8Array(256) };
      merged.set(t, m);
    }
    const ox = (i % img.def.cols) * 16, oy = Math.floor(i / img.def.cols) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const k = y * 16 + x, v = want[(oy + y) * img.w + ox + x];
        if (v === m.orig[k]) continue;
        if (m.set[k] && m.next[k] !== v) plan.conflicts++;
        else (m.next[k] = v), (m.set[k] = 1);
      }
  });
  for (const [t, m] of merged) {
    let n = 0;
    for (let k = 0; k < 256; k++) if (m.next[k] !== m.orig[k]) n++;
    if (n) plan.tiles.set(t, m.next), (plan.changedPixels += n);
  }
  return plan;
}

/** Write the planned tiles as one undo step. */
export function applyFrameImport(rs: RomSet, pairs: CPair[], plan: FrameImportPlan, label: string) {
  rs.batch(label, () => {
    for (const [t, px] of plan.tiles) {
      const loc = locateCTile(pairs, t)!;
      const { odd, even } = encodeCTile(px);
      rs.write(loc.pair.odd, loc.offset, odd, label);
      rs.write(loc.pair.even, loc.offset, even, label);
    }
  });
}

/** Tiles of `tiles` that other images of the same image table also use (editing them changes those images too). */
export function sharedTiles(rs: RomSet, graphBank: number, imageTable: number, count: number, image: number, tiles: Iterable<number>): { tiles: number; images: number[] } {
  const mine = new Set(tiles), hit = new Set<number>(), images: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i === image) continue;
    const a = rs.read32(imageTable + i * 4, graphBank) & 0xffffff;
    if (a < 0x200000 || a >= 0x300000) continue;
    let used = false;
    for (const t of decodeSpriteDef(rs, graphBank, a, "masked").cells)
      if (mine.has(t)) {
        hit.add(t);
        used = true;
      }
    if (used) images.push(i);
  }
  return { tiles: hit.size, images };
}
