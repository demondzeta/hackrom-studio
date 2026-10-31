// Checks the FBNeo IPS package: each patch, applied the way FBNeo does (window base + 3-byte offsets),
// must turn the original on-disk file into the exported one. Also covers a >16MB file.
import { exportFbneoIps, exportZip } from "../src/core/io";
import { RomSet } from "../src/core/romset";
import { unzipSync } from "fflate";
import { readFileSync } from "fs";

function fbneoApply(base: Uint8Array, ips: Uint8Array, romOffset: number) {
  const dec = new TextDecoder();
  if (dec.decode(ips.subarray(0, 5)) !== "PATCH") throw new Error("bad sig");
  let p = 5;
  for (;;) {
    if (dec.decode(ips.subarray(p, p + 3)) === "EOF") return;
    let off = (ips[p] << 16) | (ips[p + 1] << 8) | ips[p + 2];
    let size = (ips[p + 3] << 8) | ips[p + 4];
    p += 5;
    for (let k = 0; k < size; k++) base[off + romOffset + k] = ips[p++];
  }
}

function check(rs: RomSet, label: string) {
  const pkg = unzipSync(exportFbneoIps(rs, "test hack", "line one\n[weird] line"));
  const datName = Object.keys(pkg).find((n) => n.endsWith(".dat"))!;
  const dat = new TextDecoder().decode(pkg[datName]);
  console.log(label, Object.keys(pkg));
  console.log(dat);
  const exported = unzipSync(exportZip(rs, false).zip);
  for (const f of rs.files) {
    const lines = dat.split("\r\n").filter((l) => l.startsWith(`"${f.name}"`));
    const buf = new Uint8Array(f.swapped ? exported[f.name].length : f.orig.length);
    // original on-disk bytes
    const orig = f.swapped ? (() => { const o = new Uint8Array(f.orig.length); for (let i = 0; i < o.length; i += 2) { o[i] = f.orig[i + 1]; o[i + 1] = f.orig[i]; } return o; })() : f.orig;
    buf.set(orig);
    for (const l of lines) {
      const [, , ipsName, tag] = l.match(/^"([^"]+)" "([^"]+)"(?: (IPS_OFFSET_\d+))?/)!;
      fbneoApply(buf, pkg[datName.replace(/[^/]+$/, "") + ipsName], tag ? parseInt(tag.slice(11), 10) * 0x100000 : 0);
    }
    const want = exported[f.name];
    let same = want.length === buf.length;
    for (let i = 0; same && i < buf.length; i++) if (buf[i] !== want[i]) same = false;
    if (!same) console.log("MISMATCH", f.name);
  }
  console.log(label, "checked");
}

const un = unzipSync(readFileSync(process.argv[2]));
const rs = RomSet.fromFiles("kof97", Object.entries(un).map(([name, data]) => ({ name, data })));
rs.write(rs.p1, 0x9c44, [0x4e, 0x71]);
rs.write(rs.p1, 0x9c51, [0x12, 0x34, 0x56]);
const c = rs.files.findIndex((f) => f.role === "c");
rs.write(c, 0x100, [1, 2, 3, 4, 5]);
check(rs, "demo");

const big = new Uint8Array(0x2000000).fill(0xff);
const rs2 = RomSet.fromFiles("big", [{ name: "999-c1.c1", data: big }]);
rs2.write(0, 0x10, [1, 2]);
rs2.write(0, 0xfffffe, [3, 4, 5, 6]); // crosses the 16MB line
rs2.write(0, 0x1454f46, [7]); // "EOF" offset inside window 1
rs2.write(0, 0x1fffff0, [8, 9]);
check(rs2, "32MB");
