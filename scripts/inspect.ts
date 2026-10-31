// CLI: summarise any Neo Geo ROM zip (header, files, banks, main loop candidates).
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { RomSet } from "../src/core/romset";
import { readHeader, findMainLoops } from "../src/core/analysis";
import { detectProfile } from "../src/games/profiles";
import { cPairs, totalCTiles, decodeCTile } from "../src/core/gfx";

const path = process.argv[2];
const z = unzipSync(readFileSync(path));
const rs = RomSet.fromFiles(path.replace(/^.*[\/]/, "").replace(/\.zip$/i, ""), Object.entries(z).map(([name, data]) => ({ name, data })));
const h = readHeader(rs);
console.log("set", rs.setName, "profile", detectProfile(rs).id, "header", h.valid, "ngh", h.ngh.toString(16));
for (const f of rs.files) console.log(" ", f.role, f.name, f.data.length.toString(16), f.swapped ? "swapped" : "");
console.log("entries", h.entries.map((e) => `${e.name}=${e.target?.toString(16)}`).join(" "));
console.log("vblank", h.vectors.find((v) => v.vector === 0x64)?.target.toString(16));
const ml = findMainLoops(rs);
console.log("traced", ml.code.size, "insns; loops:");
for (const l of ml.loops.slice(0, 5)) console.log("  ", l.start.toString(16), "-", l.end.toString(16), l.score, l.reasons.join(", "));
const pairs = cPairs(rs);
let used = 0;
for (let t = 0; t < totalCTiles(pairs); t++) if (decodeCTile(rs, pairs, t).some((v) => v)) used++;
console.log("C tiles", totalCTiles(pairs), "non-empty", used);
