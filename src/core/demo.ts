// Builds a small synthetic "kof97-shaped" ROM set so the editor can be tried and tested without commercial ROMs.
// Layout follows the KOF97 notes: P1 code + tables, P2 banks 0001 (graphs) / 0002 (ACT), palettes, C/S ROMs.
// Nothing here comes from a real game: code, tables and graphics are generated.
import { assemble } from "./m68k/asm";
import { encodeCTile, encodeSTile, rgbToNg } from "./gfx";

const MB = 0x100000;

export function buildDemoSet(): { name: string; data: Uint8Array }[] {

const p1 = new Uint8Array(MB).fill(0xff);
const p2 = new Uint8Array(4 * MB).fill(0xff);
const w8 = (b: Uint8Array, o: number, v: number) => (b[o] = v & 0xff);
const w16 = (b: Uint8Array, o: number, v: number) => { b[o] = (v >> 8) & 0xff; b[o + 1] = v & 0xff; };
const w32 = (b: Uint8Array, o: number, v: number) => { w16(b, o, v >>> 16); w16(b, o + 2, v & 0xffff); };
const put = (b: Uint8Array, o: number, bytes: ArrayLike<number>) => b.set(bytes as any, o);
const asm = (src: string, org: number) => {
  const r = assemble(src, org);
  if (r.errors.length) throw new Error(`asm @${org.toString(16)}: ` + JSON.stringify(r.errors));
  put(p1, org, r.bytes);
  return r;
};

// ---- P1 ----
p1.fill(0, 0, 0x400);
w32(p1, 0, 0x10f300);
w32(p1, 4, 0xc00402);
w32(p1, 0x64, 0x9ea2);
w32(p1, 0x68, 0x9ea2);
put(p1, 0x100, [..."NEO-GEO"].map((c) => c.charCodeAt(0)));
w8(p1, 0x107, 0);
w16(p1, 0x108, 0x0232);
w32(p1, 0x10a, 0x00500000);
w32(p1, 0x10e, 0x00100000);
w16(p1, 0x112, 0x0100);
asm("jmp $9C38\njmp $9D00\njmp $9D00\njmp $9D00", 0x122);
asm(`
    move.w  #$2700,sr
    lea     $108000,a5
.main:
    jsr     $9F68           ; read inputs
    jsr     $12914          ; command check
    jsr     $9D10           ; run objects
    move.b  #0,$300001      ; watchdog
.wait:
    tst.b   ($10FD80).l
    beq.s   .wait
    clr.b   ($10FD80).l
    bra.s   .main
`, 0x9c38);
asm("rts", 0x9d00);
asm(`
    lea     $108100,a4
    movea.l (a4),a0
    jsr     (a0)
    lea     $108300,a4
    movea.l (a4),a0
    jsr     (a0)
    rts
`, 0x9d10);
asm("move.b #1,($10FD80).l\nrte", 0x9ea2);
asm("move.b $300000,d0\nmove.b d0,($5A44,a5)\nrts", 0x9f68);
asm("rts", 0x12914);
asm("rts", 0x584c);
asm("rts", 0x1e2fa);
asm("rts", 0x1ead8);
asm(`
    move.l  #$2FEDA,($198,a4)
    bra.w   $19DF0
`, 0x19ec4);
asm("moveq #1,d0\nrts", 0x19df0);
// Kyo routine (shape from the notes)
asm(`
    jsr     $1E2FA
    move.w  #$80,($D2,a4)
    move.w  #$82,($D4,a4)
    move.b  #$1A,($EF,a4)
    move.l  #$58000,($50,a4)
    btst    #0,($31,a4)
    bne.s   .r
    neg.l   ($50,a4)
.r: move.w  ($D2,a4),($72,a4)
    move.w  #$FFFF,($78,a4)
    jsr     $584C
    move.l  #$2FF40,(a4)
    rts
`, 0x2feda);
asm(`
    jsr     $584C
    tst.b   ($7C,a4)
    bpl.s   .n
    jmp     $1EAD8
.n: rts
`, 0x2ff40);
// command defs + check table
const defs: [number, number[]][] = [
  [0xa7bf0, [0xff, 0x00]],
  [0xa7cd2, [0x04, 0x0e, 0, 0, 0x14, 0x08, 0x28, 0x02, 0x04, 0x08, 0x04, 0xf0]],
  [0xa7cc6, [0x04, 0x0e, 0, 0, 0x14, 0x04, 0x28, 0x02, 0x04, 0x04, 0x04, 0xf0]],
  [0xa7c30, [0x04, 0x0e, 0, 0, 0x14, 0x02, 0x28, 0x0a, 0x14, 0x08, 0x2c, 0xf0]],
];
for (const [a, b] of defs) put(p1, a, b);
const tableA = [0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7cd2, 0xa7cc6, 0xa7bf0, 0xa7c30, 0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7bf0, 0xa7bf0];
tableA.forEach((v, i) => w32(p1, 0xa6e38 + i * 4, v));
tableA.forEach((v, i) => w32(p1, 0xa6e78 + i * 4, v));
// P1 ACT map
for (let c = 0; c < 35; c++) w32(p1, 0xafbca + c * 4, 0xafc56);
for (let i = 0; i < 0x100; i++) w16(p1, 0xafc56 + i * 2, i);
p1.fill(0, 0xb0000, 0xb1000);

// ---- P2 ----
for (let b = 0; b < 4; b++) w16(p2, b * MB, b);
const bank = (k: number, cpu: number) => k * MB + (cpu - 0x200000);
// bank 1: graph tables
for (let c = 0; c < 35; c++) w32(p2, bank(1, 0x200002 + c * 4), 0x20008e);
for (let i = 0; i < 0x200; i++) {
  const o = bank(1, 0x20008e + i * 6);
  w16(p2, o, -24 & 0xffff);
  w16(p2, o + 2, -96 & 0xffff);
  w16(p2, o + 4, i & 0xff);
}
for (let c = 0; c < 35; c++) w32(p2, bank(1, 0x250000 + c * 4), 0x2536c6);
for (let i = 0; i < 0x100; i++) {
  w32(p2, bank(1, 0x2536c6 + i * 4), 0x251000 + i * 12);
  const d = bank(1, 0x251000 + i * 12);
  w16(p2, d, 0x1001);
  w16(p2, d + 2, 0x0306); // 3 columns, 6 rows
  w32(p2, d + 4, 0x100 + (i % 8) * 18);
  put(p2, d + 8, [0xfc, 0xfc, 0xfc, 0x00]); // row masks: all 6 rows used in each column
}
// bank 2: ACT tables
for (let c = 0; c < 35; c++) w32(p2, bank(2, 0x200002 + c * 4), 0x20011a + c * 0x800);
const idle = 0x211964, oni = 0x212abe;
for (let a = 0; a < 0x200; a++) w32(p2, bank(2, 0x20011a + a * 4), a < 0x10 ? idle : a === 0x80 ? oni : 0xffffffff);
const act = (bytes: number[], addr: number) => put(p2, bank(2, addr), bytes);
act([3, 0, 0, 0, 0x03, 0, 0xfd, 0x04, 0xf4, 0xa0, 0x0c, 0x0c, 0xfd, 0x09, 0xf4, 0xd4, 0x14, 0x2c, 4, 0, 0, 1, 0x03, 0, 4, 0, 0, 2, 0x03, 0, 0xff, 0], idle);
act([
  2, 0, 0, 0xe1, 0, 0,
  0xfb, 0, 0xff, 0xf8, 0, 0,
  0xfd, 0x2c, 0xf0, 0xc4, 0x14, 0x18,
  0xfd, 0x0d, 0xf8, 0xbc, 0x0c, 0x0c,
  0xfd, 0x12, 0xfc, 0xe0, 0x14, 0x20,
  2, 0, 0, 0xe2, 0x07, 0,
  0xfc, 0, 0x02, 0xc5, 0, 0,
  0xfd, 0xa0, 0xd0, 0xb0, 0x10, 0x1c,
  4, 0x10, 0, 0xe3, 0x07, 0x04,
  3, 0, 0, 0xe4, 0x06, 0,
  0xfe, 0,
], oni);
// palette (Kyo A at P2 offset 0x2D1FF0; the notes list it from color 1 at 0x2D1FF2)
const pal = [0x8000, ...Array.from({ length: 15 }, (_, i) => rgbToNg(40 + i * 14, 30 + i * 10, 120 + i * 8))];
pal[5] = rgbToNg(230, 40, 40);
pal[6] = rgbToNg(250, 200, 60);
for (let v = 0; v < 4; v++) pal.forEach((c, i) => w16(p2, 0x2d1ff0 + v * 0x200 + i * 2, v ? rgbToNg(...([((c >> 8) & 15) * 16, v * 60, ((c >> 4) & 15) * 16] as [number, number, number])) : c));
p2.fill(0xff, 0x380000, 0x3fffff);

// ---- C ROMs: draw a simple figure into tiles 0x100.. (3 cols x 6 rows, column order) ----
const c1 = new Uint8Array(MB), c2 = new Uint8Array(MB);
const c3 = new Uint8Array(MB / 2), c4 = new Uint8Array(MB / 2);
const setTile = (t: number, px: Uint8Array) => {
  const { odd, even } = encodeCTile(px);
  c1.set(odd, t * 64);
  c2.set(even, t * 64);
};
for (let f = 0; f < 8; f++) {
  const W = 48, H = 96;
  const img = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const head = (x - 24) ** 2 + (y - 14) ** 2 < 100;
      const body = x > 12 && x < 36 && y > 24 && y < 64;
      const legs = y >= 64 && ((x > 12 - f && x < 21) || (x > 27 && x < 36));
      const arm = y > 28 && y < 36 && x < 18 && x > (f % 3) * 3; // stored facing left, like real KOF sprites
      img[y * W + x] = head ? 6 : arm ? 5 : body ? 3 + ((x + y) >> 3) % 4 : legs ? 10 : 0;
    }
  for (let col = 0; col < 3; col++)
    for (let row = 0; row < 6; row++) {
      const px = new Uint8Array(256);
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px[y * 16 + x] = img[(row * 16 + y) * W + col * 16 + x];
      setTile(0x100 + f * 18 + col * 6 + row, px);
    }
}
for (let t = 0; t < 0x100; t++) {
  const px = new Uint8Array(256).map((_, i) => ((i >> 4) + (i & 15) + t) % 16);
  setTile(t, px);
}

// ---- S ROM ----
const s1 = new Uint8Array(0x20000);
for (let t = 0; t < 0x1000; t++) {
  const px = new Uint8Array(64).map((_, i) => ((i % 8) ^ (i >> 3) ^ t) & 1 ? 1 + (t % 15) : 0);
  s1.set(encodeSTile(px), t * 32);
}

// MAME stores program ROMs word-swapped
const swap = (b: Uint8Array) => { const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i += 2) { o[i] = b[i + 1]; o[i + 1] = b[i]; } return o; };
return [
  { name: "232-p1.p1", data: swap(p1) },
  { name: "232-p2.sp2", data: swap(p2) },
  { name: "232-s1.s1", data: s1 },
  { name: "232-c1.c1", data: c1 },
  { name: "232-c2.c2", data: c2 },
  { name: "232-c3.c3", data: c3 },
  { name: "232-c4.c4", data: c4 },
  { name: "232-m1.m1", data: new Uint8Array(0x20000) },
  { name: "232-v1.v1", data: new Uint8Array(0x10000) },
];
}
