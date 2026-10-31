// Renders the "Live tab & move state machine" guide images from a KOF97 set and the FBNeo trace in
// scripts/data/kof97_kyo_oniyaki_trace.txt (Kyo P1 vs Iori P2, recorded with the test harness).
// usage: node .sd.cjs kof97.zip public/docs
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { deflateSync } from "node:zlib";
import { RomSet } from "../src/core/romset";
import { detectProfile, TM_BOX_COLORS, tmBoxKind } from "../src/games/profiles";
import { actFrames, actPointer, decodeSpriteDef, graphEntry, imageTableFor, kofBanks, parseAct } from "../src/games/kofEngine";
import { KOF_PALETTES } from "../src/games/kofPalettes";
import { cPairs, decodeCTile, ngToRgb, readPalette } from "../src/core/gfx";

const [, , src, outDir] = process.argv;
const z = unzipSync(readFileSync(src));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
const k = detectProfile(rs).kof!;
const banks = kofBanks(rs, k)!;
const pairs = cPairs(rs);
const KYO = 0x00, IORI = 0x1b;

function palette(name: string) {
  const e = KOF_PALETTES.kof97.find((p) => p.name === name && p.variant === "A")!;
  const off = e.p2 - 2;
  return readPalette(rs, 0x200000 + (off % 0x100000), Math.floor(off / 0x100000)).map(ngToRgb);
}

function pngBytes(W: number, H: number, rgba: Buffer, S = 2): Buffer {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let q = 0; q < 8; q++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (x: Buffer) => { let c = -1; for (const v of x) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((W * S * 4 + 1) * H * S);
  for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) { const s2 = (Math.floor(y / S) * W + Math.floor(x / S)) * 4; rgba.copy(raw, y * (W * S * 4 + 1) + 1 + x * 4, s2, s2 + 4); }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W * S, 0); ih.writeUInt32BE(H * S, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const hexc = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** One sprite panel (transparent background): ACT frame `fr` (1-based, like +$80) with its live boxes. */
function panel(ch: number, act: number, fr: number, faceRight: boolean, pal: number[][], W = 150, H = 150, OX = 75, OY = 138): string {
  const p = actPointer(rs, k, banks.actBank, ch, act);
  const frames = actFrames(parseAct(rs, banks.actBank, p.addr));
  const f = frames[Math.min(fr, frames.length) - 1];
  const img = Buffer.alloc(W * H * 4);
  const put = (x: number, y: number, c: number[], a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    const ia = img[o + 3] / 255;
    for (let q = 0; q < 3; q++) img[o + q] = Math.round(img[o + q] * ia * (1 - a) + c[q] * a);
    img[o + 3] = Math.round(255 * Math.min(1, ia + a));
  };
  const it = imageTableFor(rs, k, banks.imageBank, ch)!;
  const g = graphEntry(rs, k, banks.graphBank, ch, f.cmd.frameId);
  const def = decodeSpriteDef(rs, banks.imageBank, rs.read32(it + g.image * 4, banks.imageBank), "masked");
  const buf = new Uint8Array(256);
  const dir = faceRight ? -1 : 1;
  for (let x = 0; x < W; x++) put(x, OY, [90, 100, 130], 0.8);
  def.cells.forEach((t, i) => {
    if (t < 0) return;
    decodeCTile(rs, pairs, t, buf);
    const cx = (i % def.cols) * 16, cy = Math.floor(i / def.cols) * 16;
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const v = buf[y * 16 + x];
        if (!v) continue;
        const sx = faceRight ? OX - (g.x + cx + x) - 1 : OX + g.x + cx + x;
        put(sx, OY + g.y + cy + y, pal[v]);
      }
  });
  f.slots.forEach((b, slot) => {
    if (!b || !(f.cmd.select & (1 << slot))) return;
    const col = hexc(TM_BOX_COLORS[tmBoxKind(b.type)]);
    const cx = OX + dir * b.x, cy = OY + b.y;
    for (let y = cy - b.h; y < cy + b.h; y++)
      for (let x = cx - b.w; x < cx + b.w; x++) {
        const edge = y === cy - b.h || y === cy + b.h - 1 || x === cx - b.w || x === cx + b.w - 1;
        put(x, y, col, edge ? 1 : 0.22);
      }
  });
  return "data:image/png;base64," + pngBytes(W, H, img, 1).toString("base64");
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const FONT = `font-family="Segoe UI, Roboto, Helvetica, Arial, sans-serif"`;

/** A strip of labelled state cards. */
function stateStrip(file: string, title: string, cards: { img: string; state: string; label: string; sub: string; hl?: boolean }[]) {
  const CW = 170, PH = 150, GAP = 12, W = cards.length * (CW + GAP) + GAP, H = 262;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" rx="10" fill="#161a24"/>`, `<text x="${GAP}" y="22" fill="#e6e9f2" font-size="14" font-weight="600" ${FONT}>${esc(title)}</text>`];
  cards.forEach((c, i) => {
    const x = GAP + i * (CW + GAP), y = 34;
    parts.push(`<rect x="${x}" y="${y}" width="${CW}" height="${H - y - GAP}" rx="8" fill="${c.hl ? "#2a2238" : "#1f2433"}" stroke="${c.hl ? "#b07cff" : "#2e3550"}"/>`);
    parts.push(`<image x="${x + 10}" y="${y + 4}" width="150" height="${PH}" href="${c.img}" style="image-rendering:pixelated"/>`);
    parts.push(`<text x="${x + 10}" y="${y + PH + 22}" fill="#ffb000" font-size="13" font-weight="700" font-family="Consolas, monospace">+0 = ${esc(c.state)}</text>`);
    parts.push(`<text x="${x + 10}" y="${y + PH + 40}" fill="#e6e9f2" font-size="12" font-weight="600" ${FONT}>${esc(c.label)}</text>`);
    parts.push(`<text x="${x + 10}" y="${y + PH + 56}" fill="#9aa3bd" font-size="11" ${FONT}>${esc(c.sub)}</text>`);
  });
  parts.push("</svg>");
  writeFileSync(`${outDir}/${file}`, parts.join("\n"));
}

const kyoPal = palette("KYO KUSANAGI"), ioriPal = palette("IORI YAGAMI") ;
stateStrip("sm-kyo-states.svg", "Kyo (P1): the state in +0 decides what runs this frame — recorded in FBNeo, frames 452-604", [
  { img: panel(KYO, 0x00, 1, true, kyoPal), state: "$00F464", label: "Standing (neutral)", sub: "ACT 000 · polls commands" },
  { img: panel(KYO, 0x01, 2, true, kyoPal), state: "$00FBC6", label: "Walking forward", sub: "ACT 001 · input 6 held" },
  { img: panel(KYO, 0x15, 2, true, kyoPal), state: "$00FD02", label: "Crouching", sub: "ACT 015 · input 2 held" },
  { img: panel(KYO, 0x81, 3, true, kyoPal), state: "$02FDE4", label: "Oniyaki phase 1", sub: "ACT 081 · +198 = $02FCF0", hl: true },
  { img: panel(KYO, 0x83, 2, true, kyoPal), state: "$02FE56", label: "Oniyaki phase 2", sub: "ACT 083 · rising, fire spawned", hl: true },
  { img: panel(KYO, 0x85, 2, true, kyoPal), state: "$02FECC", label: "Oniyaki landing", sub: "ACT 085 · then jmp $1EAD8", hl: true },
]);
stateStrip("sm-iori-hit.svg", "Iori (P2) at the same time: being hit is also just a chain of states", [
  { img: panel(IORI, 0x00, 1, false, ioriPal), state: "$00F464", label: "Standing (neutral)", sub: "ACT 000" },
  { img: panel(IORI, 0x00, 1, false, ioriPal), state: "$01633E", label: "Hit freeze", sub: "both fighters stop ~11 frames", hl: true },
  { img: panel(IORI, 0x102, 1, false, ioriPal), state: "$018A3A", label: "Hit reaction", sub: "ACT 102 · HP $67 → $57", hl: true },
  { img: panel(IORI, 0x102, 3, false, ioriPal), state: "$016C3A", label: "Pushback / recovery", sub: "ACT 102 last frames" },
  { img: panel(IORI, 0x00, 2, false, ioriPal), state: "$00F464", label: "Back to neutral", sub: "frame 569" },
]);

// ---------- timeline of the recorded trace ----------
const rows = readFileSync("scripts/data/kof97_kyo_oniyaki_trace.txt", "utf8").split(/\r?\n/).map((l) => l.match(/^f(\d+) in=(\w+)\s+\+0=(\w+) \+198=(\w+) \+1C6=(\w+)\s+ACT=(\w+) fr=(\w+) cnt=\w+ 7C=(\w+).*P2 \+0=(\w+) ACT=(\w+) hp=(\w+)/)).filter(Boolean) as RegExpMatchArray[];
const F0 = 515, F1 = 606;
const tl = rows.filter((r) => +r[1] >= F0 && +r[1] <= F1);
const PX = 9, LX = 150, TW = LX + (F1 - F0 + 1) * PX + 20, TH = 300;
const NAMES: Record<string, string> = { "00F464": "standing", "00FBC6": "walk", "00FD02": "crouch", "00FDB4": "crouch (motion done)", "02FDE4": "Oniyaki 1", "01633E": "hit freeze", "0163F4": "freeze", "016402": "freeze", "02FE56": "Oniyaki 2", "02FE78": "Oniyaki 2b", "02FEAA": "falling", "02FECC": "landing", "016664": "freeze", "018A3A": "hit reaction", "016BEE": "pushback", "016C3A": "pushback" };
const COLORS = ["#3d6ea8", "#5a8f4e", "#8a6d3b", "#a0516e", "#6c5aa8", "#3b8a87", "#a8743d", "#7f8c99"];
const colorOf = new Map<string, string>();
const col = (v: string) => { if (!colorOf.has(v)) colorOf.set(v, COLORS[colorOf.size % COLORS.length]); return colorOf.get(v)!; };
const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${TW}" height="${TH}" viewBox="0 0 ${TW} ${TH}">`, `<rect width="${TW}" height="${TH}" rx="10" fill="#161a24"/>`,
  `<text x="12" y="22" fill="#e6e9f2" font-size="14" font-weight="600" ${FONT}>Frame by frame: → ↓ ↘+C becomes Kyo's Oniyaki (KOF97, recorded in FBNeo)</text>`];
const lanes: { label: string; get: (r: RegExpMatchArray) => string; text: (v: string) => string; y: number }[] = [
  { label: "joystick (BIOS)", get: (r) => r[2], text: (v) => ({ "00": "—", "08": "6", "02": "2", "4A": "3+C" }[v] ?? v), y: 40 },
  { label: "P1 +0 (state)", get: (r) => r[3], text: (v) => NAMES[v] ?? "$" + v, y: 78 },
  { label: "P1 +$198 (routine)", get: (r) => r[4], text: (v) => (v === "000000" ? "0" : "$" + v), y: 116 },
  { label: "P1 +$1C6 (saved)", get: (r) => r[5], text: (v) => (v === "000000" ? "0" : "$" + v), y: 154 },
  { label: "P1 ACT (+$72)", get: (r) => r[6], text: (v) => "ACT " + v, y: 192 },
  { label: "P2 +0 (state)", get: (r) => r[9], text: (v) => NAMES[v] ?? "$" + v, y: 230 },
];
for (const lane of lanes) {
  svg.push(`<text x="12" y="${lane.y + 18}" fill="#9aa3bd" font-size="12" ${FONT}>${esc(lane.label)}</text>`);
  let i = 0;
  while (i < tl.length) {
    const v = lane.get(tl[i]);
    let j = i;
    while (j + 1 < tl.length && lane.get(tl[j + 1]) === v) j++;
    const x = LX + (+tl[i][1] - F0) * PX, w = (j - i + 1) * PX - 1;
    svg.push(`<rect x="${x}" y="${lane.y}" width="${w}" height="26" rx="3" fill="${v === "00" || v === "000000" ? "#232838" : col(lane.label.startsWith("P1 ACT") ? "a" + v : v)}"/>`);
    const t = lane.text(v);
    if (w > t.length * 6.2) svg.push(`<text x="${x + 4}" y="${lane.y + 17}" fill="#ffffff" font-size="11" ${FONT}>${esc(t)}</text>`);
    i = j + 1;
  }
}
for (let f = F0; f <= F1; f += 10) {
  const x = LX + (f - F0) * PX;
  svg.push(`<line x1="${x}" y1="34" x2="${x}" y2="${TH - 30}" stroke="#2e3550" stroke-width="1"/><text x="${x + 2}" y="${TH - 14}" fill="#6b7591" font-size="10" ${FONT}>f${f}</text>`);
}
const disp = LX + (529 - F0) * PX;
svg.push(`<line x1="${disp}" y1="34" x2="${disp}" y2="${TH - 30}" stroke="#ffb000" stroke-width="2" stroke-dasharray="4 3"/><text x="${disp + 4}" y="${TH - 32}" fill="#ffb000" font-size="11" ${FONT}>dispatcher $101D8 runs</text>`);
svg.push("</svg>");
writeFileSync(`${outDir}/sm-timeline.svg`, svg.join("\n"));
console.log("written sm-kyo-states.svg, sm-iori-hit.svg, sm-timeline.svg");
