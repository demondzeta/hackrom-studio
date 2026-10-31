// Print the decoded move list of characters: node .ml.cjs kof97.zip [ch...]
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { RomSet } from "../src/core/romset";
import { detectProfile } from "../src/games/profiles";
import { analyzeMoves, buttonsText, commandSlots, commandTableFor, handlerFor, inputToArrows } from "../src/games/kofEngine";
const z = unzipSync(readFileSync(process.argv[2]));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
const p = detectProfile(rs), k = p.kof!;
const h = (n: number) => n.toString(16).toUpperCase();
for (const a of process.argv.slice(3)) {
  const ch = parseInt(a, 16);
  const table = commandTableFor(rs, k, ch, 1)!;
  const slots = commandSlots(rs, table);
  console.log(`== ${p.characters[ch]} handler $${h(handlerFor(rs, k, ch)!)} table R $${h(table)} (${slots.length} slots)`);
  for (const m of analyzeMoves(rs, k, ch)) {
    const motion = m.slot !== null && slots[m.slot] ? slots[m.slot].def.steps.map((s) => inputToArrows(s.input)).join(" ") : m.check ? `check $${h(m.check)}` : "?";
    console.log(`  ${m.context.padEnd(10)} ${m.kind.padEnd(14)} slot ${String(m.slot ?? "-").padStart(2)} ${motion.padEnd(18)} +${buttonsText(m.buttons).padEnd(7)} -> $${h(m.routine)}  ACTs ${m.acts.map(h).join(",")}  dmg ${m.damage.map(h).join(",")}`);
  }
}
