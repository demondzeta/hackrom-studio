// KOF2002 (NGH 0265) program ROM scramble: the 4MB P2 is stored as eight 512KB blocks out of order
// (MAME/FBNeo kof2002_decrypt_68k). Reordering is one-to-one, so edits are scrambled back on export.
// The original set and the kof2002b bootleg both use it.

/** Source offset in the stored P2 of each 512KB block of the 68k view. */
const BLOCKS = [0x100000, 0x280000, 0x300000, 0x180000, 0x000000, 0x380000, 0x200000, 0x080000];
const BLOCK = 0x80000;

export function isKof2002P2(data: Uint8Array, ngh: number): boolean {
  return ngh === 0x0265 && data.length === 0x400000;
}

export function kof2002Descramble(raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(raw.length);
  BLOCKS.forEach((src, i) => out.set(raw.subarray(src, src + BLOCK), i * BLOCK));
  return out;
}

export function kof2002Scramble(dec: Uint8Array): Uint8Array {
  const out = new Uint8Array(dec.length);
  BLOCKS.forEach((src, i) => out.set(dec.subarray(i * BLOCK, (i + 1) * BLOCK), src));
  return out;
}

// kof2002b bootleg graphics: inside every group of 512 tiles the 16x16 tiles are stored out of order
// (MAME neoboot_prot_device::kof2002b_gfx_decrypt). In MAME's interleaved C region one tile is 128 bytes,
// which is 64 bytes in each file of a c1/c2 pair, so the same tile order applies to every C file.
const T: number[][] = [
  [0, 8, 7, 6, 2, 1],
  [1, 0, 8, 7, 6, 2],
  [2, 1, 0, 8, 7, 6],
  [6, 2, 1, 0, 8, 7],
  [7, 6, 2, 1, 0, 8],
  [0, 1, 2, 6, 7, 8],
  [2, 1, 0, 6, 7, 8],
  [8, 0, 7, 6, 2, 1],
];
let tileMap: Int16Array | null = null;
/** For stored tile j (0-511) of a group, the tile number it really is. */
function kof2002bTileMap(): Int16Array {
  if (tileMap) return tileMap;
  tileMap = new Int16Array(512);
  const bit = (v: number, b: number) => (v >> b) & 1;
  for (let j = 0; j < 512; j++) {
    const t = T[(j & 0x38) >> 3];
    // bitswap<16>(j, 15..9, t0, t1, t2, 5, 4, 3, t3, t4, t5): listed bits go to positions 15..0
    const order = [15, 14, 13, 12, 11, 10, 9, t[0], t[1], t[2], 5, 4, 3, t[3], t[4], t[5]];
    let v = 0;
    order.forEach((b, i) => (v |= bit(j, b) << (15 - i)));
    tileMap[j] = v;
  }
  return tileMap;
}

export function isKof2002bGfx(name: string, ngh: number): boolean {
  return ngh === 0x0265 && /^2k2-c\d/i.test(name.split(/[\/]/).pop() ?? name);
}

const TILE = 64; // bytes of one tile in one C file
const GROUP = 512 * TILE;

export function kof2002bGfxDescramble(raw: Uint8Array): Uint8Array {
  const map = kof2002bTileMap();
  const out = new Uint8Array(raw.length);
  for (let g = 0; g + GROUP <= raw.length; g += GROUP)
    for (let j = 0; j < 512; j++) out.set(raw.subarray(g + j * TILE, g + (j + 1) * TILE), g + map[j] * TILE);
  return out;
}

export function kof2002bGfxScramble(dec: Uint8Array): Uint8Array {
  const map = kof2002bTileMap();
  const out = new Uint8Array(dec.length);
  for (let g = 0; g + GROUP <= dec.length; g += GROUP)
    for (let j = 0; j < 512; j++) out.set(dec.subarray(g + map[j] * TILE, g + (map[j] + 1) * TILE), g + j * TILE);
  return out;
}
