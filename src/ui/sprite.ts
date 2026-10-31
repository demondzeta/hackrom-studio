import { CPair, decodeCTile, RGBA, writeCTile } from "../core/gfx";
import type { RomSet } from "../core/romset";

export type Order = "colmajor" | "rowmajor";

/** Tile numbers for a cols×rows block starting at base (row-major cell list). */
export function blockCells(base: number, cols: number, rows: number, order: Order): number[] {
  const cells = new Array(cols * rows);
  let t = base;
  if (order === "rowmajor") for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells[r * cols + c] = t++;
  else for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) cells[r * cols + c] = t++;
  return cells;
}

/** Decode a block of tiles into one indexed image. */
export function blockPixels(rs: RomSet, pairs: CPair[], cells: number[], cols: number, rows: number): Uint8Array {
  const W = cols * 16;
  const out = new Uint8Array(W * rows * 16);
  const buf = new Uint8Array(256);
  cells.forEach((t, i) => {
    if (t < 0) return;
    decodeCTile(rs, pairs, t, buf);
    const ox = (i % cols) * 16, oy = Math.floor(i / cols) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) out[(oy + y) * W + ox + x] = buf[y * 16 + x];
  });
  return out;
}

export function writeBlock(rs: RomSet, pairs: CPair[], cells: number[], cols: number, px: Uint8Array, label: string) {
  const W = cols * 16;
  rs.batch(label, () => {
    cells.forEach((t, i) => {
      if (t < 0) return;
      const ox = (i % cols) * 16, oy = Math.floor(i / cols) * 16;
      const tile = new Uint8Array(256);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) tile[y * 16 + x] = px[(oy + y) * W + ox + x] ?? 0;
      writeCTile(rs, pairs, t, tile, label);
    });
  });
}

export function drawIndexed(ctx: CanvasRenderingContext2D, px: Uint8Array, w: number, h: number, pal: RGBA[], dx = 0, dy = 0, flipX = false) {
  const img = ctx.getImageData(dx, dy, w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = px[y * w + (flipX ? w - 1 - x : x)];
      const c = pal[v];
      if (!c || c[3] === 0) continue;
      const o = (y * w + x) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  ctx.putImageData(img, dx, dy);
}
