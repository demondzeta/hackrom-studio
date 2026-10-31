// Checks CRC forcing: random buffers, and an edited synthetic KOF set exported with keepCrc.
import { crc32, forceCrc32 } from "../src/core/bytes";
import { exportZip } from "../src/core/io";
import { RomSet } from "../src/core/romset";
import { unzipSync } from "fflate";
import { readFileSync } from "fs";

let ok = 0;
for (let n = 0; n < 200; n++) {
  const len = 4 + Math.floor(Math.random() * 5000);
  const b = new Uint8Array(len).map(() => (Math.random() * 256) | 0);
  const target = (Math.random() * 2 ** 32) >>> 0;
  const pos = Math.floor(Math.random() * (len - 3));
  forceCrc32(b, pos, target);
  if (crc32(b) === target) ok++;
}
console.log("random forcing", ok, "/ 200");

const un = unzipSync(readFileSync(process.argv[2]));
const rs = RomSet.fromFiles("demo", Object.entries(un).map(([name, data]) => ({ name, data })));
rs.write(rs.p1, 0x9c44, [0x4e, 0x71]);
const c = rs.files.findIndex((f) => f.role === "c");
rs.write(c, 0x100, [1, 2, 3, 4, 5]);
const { zip, fixes } = exportZip(rs, true);
const back = unzipSync(zip);
console.log(fixes);
for (const f of rs.files) if (crc32(back[f.name]) !== f.origCrc) console.log("MISMATCH", f.name);
const p1 = rs.files[rs.p1];
console.log("p1 edit kept:", back[p1.name][0x9c45].toString(16), back[p1.name][0x9c44].toString(16));
