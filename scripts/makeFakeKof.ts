// Writes the synthetic demo set (src/core/demo.ts) as a MAME-style zip for headless tests.
import { writeFileSync } from "node:fs";
import { zipSync } from "fflate";
import { buildDemoSet } from "../src/core/demo";

const out = process.argv[2] ?? "kof97.zip";
const zip = zipSync(Object.fromEntries(buildDemoSet().map((f) => [f.name, f.data])));
writeFileSync(out, zip);
console.log("wrote", out, zip.length, "bytes");
