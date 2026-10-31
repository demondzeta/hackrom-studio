import { assemble } from "../src/core/m68k/asm";
import { disasm } from "../src/core/m68k/disasm";
import { ngToRgb, rgbToNg, encodeCTile, encodeSTile, decodeSTile, cPairs, readPalette } from "../src/core/gfx";
import { decodePng } from "../src/core/png";
import { RomSet } from "../src/core/romset";
import { buildDemoSet } from "../src/core/demo";
import { detectProfile } from "../src/games/profiles";
import { decodeSpriteDef, graphEntry, imageTableFor, kofBanks } from "../src/games/kofEngine";
import { applyFrameImport, frameToPng, planFrameImport, readFrame } from "../src/games/framePng";
import { kof98Decrypt, kof98Encrypt, kof98UnusedSpot, kof98WordMap } from "../src/core/kof98crypt";
import { kof2002bGfxDescramble, kof2002bGfxScramble, kof2002Descramble, kof2002Scramble } from "../src/core/kof2002crypt";

let fails = 0;
const check = (cond: boolean, msg: string) => { if (!cond) { fails++; console.log("FAIL", msg); } };

const src = `
start:
  move.w  #$80,($D2,a4)
  move.l  #$2FEDA,($198,a4)
  move.b  ($7B,a3),d0
  andi.b  #$A0,d0
  beq.s   skip
  btst    #4,($5,a6)
  movea.l ($198,a4),a0
  jmp     (a0)
skip:
  move.w  (d2),($72,a4)
  move.w  #$FFFF,($78,a4)
  jsr     $584C
  move.l  #start,(a4)
  tst.b   ($7C,a4)
  bpl.w   start
  lea     skip(pc),a0
  movem.l d0-d7/a0-a6,-(sp)
  movem.l (sp)+,d0-d7/a0-a6
  addq.w  #1,($80,a4)
  cmpi.w  #$10,d1
  lsl.w   #2,d0
  move.b  $10FD96,d0
  dbra    d1,skip
  subi.l  #$10000,($50,a4)
  neg.l   ($50,a4)
  moveq   #-1,d0
  rts
`.replace("move.w  (d2),($72,a4)", "move.w  ($D2,a4),($72,a4)");
const r = assemble(src, 0x2FE00);
check(r.errors.length === 0, "asm errors: " + JSON.stringify(r.errors));
const mem = r.bytes;
const rd = (a: number) => mem[a - 0x2FE00] ?? 0;
let a = 0x2FE00;
const lines: string[] = [];
while (a < 0x2FE00 + mem.length) { const i = disasm(rd, a); lines.push(i.addr.toString(16) + "  " + i.text); if (i.kind === "invalid") fails++; a += i.size; }
console.log(lines.join("\n"));
// reassemble the disassembly and compare bytes
const resrc = lines.map((l) => l.slice(l.indexOf("  ") + 2)).join("\n").replace(/\(\$([0-9A-F]+)\)\.l/g, "$$$1");
const r2 = assemble(resrc, 0x2FE00);
check(r2.errors.length === 0, "reasm errors " + JSON.stringify(r2.errors));
check(Buffer.from(r2.bytes).equals(Buffer.from(mem)), "roundtrip bytes differ\n" + Buffer.from(r2.bytes).toString("hex") + "\n" + Buffer.from(mem).toString("hex"));
// known encodings
const k = assemble("move.l #$2FEDA,($198,a4)\nnop\njsr $1E2FA", 0);
check(Buffer.from(k.bytes).toString("hex") === "297c0002feda01984e714eb90001e2fa", "known encoding " + Buffer.from(k.bytes).toString("hex"));

// palette roundtrip
for (const w of [0x7fff, 0x0000, 0x8000, 0x4f5b, 0x1064, 0x2a3c]) {
  const [r, g, b] = ngToRgb(w);
  const w2 = rgbToNg(r, g, b);
  const [r2, g2, b2] = ngToRgb(w2);
  check(r === r2 && g === g2 && b === b2, `palette roundtrip ${w.toString(16)} -> ${w2.toString(16)}`);
}
// tile roundtrip (S)
const px = new Uint8Array(64).map((_, i) => (i * 7) & 15);
check(Buffer.from(decodeSTile(encodeSTile(px), 0)).equals(Buffer.from(px)), "S tile roundtrip");
// frame PNG round trip on the demo set: export -> import unchanged = no writes; an edit only touches the frame's tiles
{
  const rs = RomSet.fromFiles("kof97", buildDemoSet());
  const k = detectProfile(rs).kof!, b = kofBanks(rs, k)!, pairs = cPairs(rs);
  const g = graphEntry(rs, k, b.graphBank, 0, 1);
  const def = decodeSpriteDef(rs, b.graphBank, rs.read32(imageTableFor(rs, k, b.graphBank, 0)! + g.image * 4, b.graphBank), "masked");
  const pal = readPalette(rs, 0x2d1ff0, b.actBank);
  const img = readFrame(rs, pairs, def);
  const png = decodePng(frameToPng(img, pal));
  check(png.w === img.w && png.h === img.h, "frame png size");
  const same = planFrameImport(rs, pairs, img, png, pal);
  check(!same.error && same.tiles.size === 0 && same.changedPixels === 0, "frame png unchanged roundtrip " + JSON.stringify({ ...same, tiles: same.tiles.size }));
  const [r, gg, bb] = ngToRgb(pal[1]);
  for (let x = 0; x < png.w; x++) png.data.set([r, gg, bb, 255], (40 * png.w + x) * 4);
  const plan = planFrameImport(rs, pairs, img, png, pal);
  check(plan.tiles.size === def.cols && plan.changedPixels > 0 && plan.outsidePixels === 0, "frame png edit plan " + plan.tiles.size);
  applyFrameImport(rs, pairs, plan, "test");
  const after = readFrame(rs, pairs, def);
  check(Array.from({ length: png.w }, (_, x) => after.px[40 * png.w + x]).every((v) => v === 1), "frame png edit applied");
  png.data.set([r, gg, bb, 255], (95 * png.w + 47) * 4);
  check(planFrameImport(rs, pairs, after, png, pal).tiles.size === 1, "frame png single pixel");
}
// KOF98 P1 encryption: the word shuffle is one-to-one, so decrypt → edit → encrypt → decrypt keeps every edit
{
  const map = kof98WordMap();
  check(new Set(map).size === map.length, "kof98 word map is one-to-one");
  const raw = new Uint8Array(0x200000);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 7 + (i >> 9)) & 0xff;
  const dec = kof98Decrypt(raw);
  dec[0x9c14] ^= 0xff;
  dec[0xfffff] ^= 0x55;
  const back = kof98Decrypt(kof98Encrypt(dec, raw));
  check(back.every((v, i) => v === dec[i]), "kof98 encrypt/decrypt round trip");
  const spot = kof98UnusedSpot();
  const poked = kof98Encrypt(dec, raw);
  poked[spot] ^= 0xff;
  check(spot >= 0 && kof98Decrypt(poked).every((v, i) => v === dec[i]), "kof98 CRC spot is never read");
}
// KOF2002 P2 block order and kof2002b tile shuffle are permutations: scramble(descramble(x)) == x
{
  const p2 = new Uint8Array(0x400000);
  for (let i = 0; i < p2.length; i++) p2[i] = (i >> 19) ^ (i & 0xff);
  check(kof2002Scramble(kof2002Descramble(p2)).every((v, i) => v === p2[i]), "kof2002 P2 block round trip");
  check(kof2002Descramble(p2)[0] === p2[0x100000], "kof2002 P2 block 0 comes from $100000");
  const c = new Uint8Array(0x10000);
  for (let i = 0; i < c.length; i++) c[i] = (i >> 6) & 0xff;
  const d = kof2002bGfxDescramble(c);
  check(kof2002bGfxScramble(d).every((v, i) => v === c[i]), "kof2002b tile shuffle round trip");
  check(new Set(Array.from({ length: 512 }, (_, t) => d[t * 64])).size === 256, "kof2002b tile shuffle keeps every tile");
}
console.log(fails ? `${fails} failure(s)` : "all self-tests passed");
process.exit(fails ? 1 : 0);
