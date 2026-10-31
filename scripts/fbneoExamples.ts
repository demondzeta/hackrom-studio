// Builds patched KOF97 sets for the tutorial examples with the same code the app's Tutorials use.
// usage: node .ex.mjs <clean kof97.zip> <example[+example]> <out.zip>
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { RomSet } from "../src/core/romset";
import { exportZip } from "../src/core/io";
import { EXAMPLES, ExampleId } from "../src/tutorials/examples";

const [, , src, example, out] = process.argv;
const z = unzipSync(readFileSync(src));
const rs = RomSet.fromFiles("kof97", Object.entries(z).map(([name, data]) => ({ name, data })));
for (const ex of example.split("+")) if (ex !== "base") console.log(ex + ": " + EXAMPLES[ex as ExampleId](rs));
writeFileSync(out, exportZip(rs).zip);
