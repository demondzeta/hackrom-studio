// Validate the KOF profile against a real set: node .realcheck.cjs path/to/kof97.zip
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { RomSet } from "../src/core/romset";
import { detectProfile } from "../src/games/profiles";
import { kofBanks, listActs, parseAct, actFrames, graphEntry, scanImageTables, scanCommandTables, parseCommand, inputToArrows, serializeAct } from "../src/games/kofEngine";
import { disasmRange } from "../src/core/m68k/disasm";
import { findMoveLImmToDisp } from "../src/core/analysis";
import { readPalette } from "../src/core/gfx";
const z = unzipSync(readFileSync(process.argv[2]));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
const p = detectProfile(rs), k = p.kof!;
const h = (n: number, w = 6) => n.toString(16).toUpperCase().padStart(w, "0");
console.log("bank ids", rs.banks.map((_, i) => h(rs.read16(0x200000, i), 4)).join(" "));
const b = kofBanks(rs, k)!; console.log("graphBank", b.graphBank, "actBank", b.actBank);
console.log("ACT char table", [0, 1, 2, 27].map((c) => h(rs.read32(k.charTable + c * 4, b.actBank))).join(" "));
console.log("graph char table", [0, 1, 2].map((c) => h(rs.read32(k.charTable + c * 4, b.graphBank))).join(" "));
const acts = listActs(rs, k, b.actBank, 0); console.log("Kyo acts", acts.length, "act80 ->", h(acts.find((a) => a.act === 0x80)?.addr ?? 0));
const s = parseAct(rs, b.actBank, acts.find((a) => a.act === 0x80)!.addr);
console.log("act80", s.size, "terminated", s.terminated, s.cmds.map((c) => c.t).join(","));
for (const f of actFrames(s)) console.log("  frame", h(f.cmd.frameId, 4), "dur", f.cmd.dur, "eff", h(f.cmd.effect, 2), "sel", h(f.cmd.select, 2), "cxl", h(f.cmd.cancel, 2), "boxes", f.activeBoxes.map((x) => `${h(x.type, 2)}(${x.x},${x.y},${x.w},${x.h})`).join(" "));
console.log("roundtrip", serializeAct(s.cmds).join() === Array.from(rs.readBytes(s.addr, s.size, b.actBank)).join());
let ok = 0, bad = 0; for (const a of acts) { const sc = parseAct(rs, b.actBank, a.addr); sc.terminated && sc.cmds.every((c) => c.t !== "raw") ? ok++ : bad++; } console.log("Kyo ACT scripts clean", ok, "with unknown cmds/unterminated", bad);
let raw = new Map<number, number>(); for (let c = 0; c < 32; c++) for (const a of listActs(rs, k, b.actBank, c)) for (const cmd of parseAct(rs, b.actBank, a.addr).cmds) if (cmd.t === "raw") raw.set(cmd.bytes[0], (raw.get(cmd.bytes[0]) ?? 0) + 1);
console.log("unknown command bytes over all chars", [...raw].map(([x, n]) => h(x, 2) + "x" + n).join(" "));
const g = graphEntry(rs, k, b.graphBank, 0, 0xe1); console.log("graph E1", g, "addr", h(g.addr));
const img = rs.read32(0x2536c6 + g.image * 4, b.graphBank); console.log("img ptr", h(img), "def bytes", Array.from(rs.readBytes(img, 24, b.graphBank)).map((x) => h(x, 2)).join(" "));
for (const im of [0, 1, 2, 0x10]) { const a = rs.read32(0x2536c6 + im * 4, b.graphBank); console.log(" img", h(im, 3), h(a), Array.from(rs.readBytes(a, 20, b.graphBank)).map((x) => h(x, 2)).join(" ")); }
console.log("image tables", scanImageTables(rs, b.graphBank).slice(0, 40).map((t) => h(t.addr) + ":" + t.count).join(" "));
const ct = scanCommandTables(rs, k.commandArea!); console.log("cmd tables", ct.length, ct.slice(0, 6).map((x) => h(x)).join(" "));
for (let i = 0; i < 16; i++) { const ptr = rs.read32(0xa6e38 + i * 4); const d = parseCommand(rs, ptr); console.log("  Kyo slot", i, h(ptr), d.empty ? "empty" : d.steps.map((s) => inputToArrows(s.input) + "/" + h(s.mode, 2)).join(" ") + " win " + d.window); }
const sites = findMoveLImmToDisp(rs.files[rs.p1].data, 0x198); console.log("routine sites", sites.length, sites.filter((s) => s.value === 0x2feda).map((s) => h(s.addr)));
console.log("palette Kyo A", readPalette(rs, 0x2d1ff2, rs.banks.findIndex((x) => x.offset === 0x200000)).map((w) => h(w, 4)).join(" "));
for (const a of [0x9c38, 0x101d8, 0x19ea8]) { console.log("--", h(a)); for (const i of disasmRange(rs.reader(0), a, 10)) console.log("  ", h(i.addr), i.text); }
