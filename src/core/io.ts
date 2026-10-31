// Loading ROM sets (zip or loose files) and exporting patched sets, IPS patches and project files.
import { unzipSync, zipSync } from "fflate";
import { crc32, forceCrc32, hex8 } from "./bytes";
import { RomSet } from "./romset";
import { kof98UnusedSpot } from "./kof98crypt";
import { tr } from "../i18n";

export async function loadFiles(files: File[]): Promise<RomSet> {
  const entries: { name: string; data: Uint8Array }[] = [];
  let setName = "romset";
  for (const f of files) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (/\.zip$/i.test(f.name)) {
      setName = f.name.replace(/\.zip$/i, "");
      const un = unzipSync(buf);
      for (const [name, data] of Object.entries(un)) if (!name.endsWith("/")) entries.push({ name: name.split("/").pop()!, data });
    } else entries.push({ name: f.name, data: buf });
  }
  if (!entries.length) throw new Error("No ROM files found");
  return RomSet.fromFiles(setName, entries);
}

export interface CrcFix {
  name: string;
  /** on-disk offset of the 4 adjusted bytes, or -1 when no safe spot was found */
  offset: number;
}

/**
 * Place for the 4 CRC bytes: the middle of an unedited run of identical filler bytes (00 or FF),
 * searched from the end of the file, where padding usually sits.
 */
function crcFixSpot(cur: Uint8Array, orig: Uint8Array): number {
  const MIN_RUN = 64;
  let end = cur.length;
  while (end > 0) {
    const v = cur[end - 1];
    if (v !== orig[end - 1]) {
      end--;
      continue;
    }
    let start = end - 1;
    while (start > 0 && cur[start - 1] === v && orig[start - 1] === v) start--;
    if ((v === 0x00 || v === 0xff) && end - start >= MIN_RUN) return (start + ((end - start) >> 1)) & ~3;
    end = start;
  }
  return -1;
}

/**
 * Bytes of a file as exported. With `keepCrc`, an edited file gets 4 filler bytes adjusted so its CRC32
 * matches the original dump, which FBNeo (and Fightcade / RetroArch) need to load the set.
 */
export function exportFileBytes(rs: RomSet, file: number, keepCrc: boolean): { bytes: Uint8Array; fix?: CrcFix } {
  const f = rs.files[file];
  const cur = rs.exportBytes(file);
  if (!keepCrc || !rs.isModified(file)) return { bytes: cur };
  const bytes = new Uint8Array(cur);
  const orig = rs.originalBytes(file);
  // encrypted KOF98 P1: half of the file is never read by the game, so the CRC bytes go there
  const offset = f.cipher?.kind === "kof98" ? kof98UnusedSpot() : crcFixSpot(bytes, orig);
  if (offset >= 0) forceCrc32(bytes, offset, f.origCrc);
  return { bytes, fix: { name: f.name, offset } };
}

/** Zip containing every file in its original byte order with edits applied. */
export function exportZip(rs: RomSet, keepCrc = false): { zip: Uint8Array; fixes: CrcFix[] } {
  const obj: Record<string, Uint8Array> = {};
  const fixes: CrcFix[] = [];
  rs.files.forEach((f, i) => {
    const { bytes, fix } = exportFileBytes(rs, i, keepCrc);
    obj[f.name] = bytes;
    if (fix) fixes.push(fix);
  });
  return { zip: zipSync(obj, { level: 6 }), fixes };
}

const IPS_WINDOW = 0x1000000;

/**
 * Standard IPS patch for one file, in the on-disk byte order. IPS offsets are 3 bytes, so one patch covers
 * a 16MB window: `window` n patches bytes n*16MB .. (n+1)*16MB, with offsets relative to the window start
 * (FBNeo's IPS_OFFSET_016... tags add the window base back).
 */
export function makeIps(rs: RomSet, file: number, keepCrc = false, window = 0): Uint8Array {
  const f = rs.files[file];
  const cur = exportFileBytes(rs, file, keepCrc).bytes;
  const orig = rs.originalBytes(file);
  const base = window * IPS_WINDOW;
  const limit = Math.min(cur.length, base + IPS_WINDOW);
  const out: number[] = [...new TextEncoder().encode("PATCH")];
  let i = base;
  while (i < limit) {
    if (cur[i] === orig[i]) {
      i++;
      continue;
    }
    let start = i;
    // align word-swapped files to even offsets so patches stay valid in both byte orders
    if (f.swapped && start & 1) start--;
    let end = i;
    while (end < limit && end - start < 0xffff) {
      if (cur[end] !== orig[end]) end++;
      else {
        // allow small equal gaps to avoid many records
        let gap = 0;
        while (end + gap < limit && cur[end + gap] === orig[end + gap] && gap < 6) gap++;
        if (gap < 6 && end + gap < limit) end += gap;
        else break;
      }
    }
    if (f.swapped && end & 1) end++;
    end = Math.min(end, limit, start + 0xffff);
    if (start - base === 0x454f46) start--; // "EOF" offset collision
    const rel = start - base;
    out.push((rel >> 16) & 0xff, (rel >> 8) & 0xff, rel & 0xff, ((end - start) >> 8) & 0xff, (end - start) & 0xff);
    for (let k = start; k < end; k++) out.push(cur[k]);
    i = end;
  }
  out.push(...new TextEncoder().encode("EOF"));
  return Uint8Array.from(out);
}

/** 16MB windows of a file that contain edits (one IPS patch is needed per window). */
export function ipsWindows(rs: RomSet, file: number): number[] {
  const wins = new Set<number>();
  for (const d of rs.diff(file)) {
    wins.add(Math.floor(d.offset / IPS_WINDOW));
    wins.add(Math.floor((d.offset + d.length - 1) / IPS_WINDOW));
  }
  return [...wins].sort((a, b) => a - b);
}

/**
 * Patch package for FBNeo's IPS Patch Manager: unzip into the FBNeo folder, then tick the patch in
 * Load Game → IPS Manager. FBNeo checks the CRCs of the untouched set and applies the patches in memory.
 * Layout: support/ips/<set>/<hack>.dat plus one .ips per edited file (per 16MB window for bigger files).
 */
export function exportFbneoIps(rs: RomSet, hackName: string, description: string): Uint8Array {
  const safe = hackName.trim().replace(/[^A-Za-z0-9_-]+/g, "_") || "hack";
  const dir = `support/ips/${rs.setName}/`;
  const obj: Record<string, Uint8Array> = {};
  const lines: string[] = [];
  rs.files.forEach((f, i) => {
    if (!rs.isModified(i)) return;
    const stem = f.name.replace(/\.[^.]*$/, "");
    for (const w of ipsWindows(rs, i)) {
      const ipsName = `${safe}_${stem}${w ? `_${w * 16}MB` : ""}.ips`;
      obj[dir + ipsName] = makeIps(rs, i, false, w);
      const offTag = w ? ` IPS_OFFSET_${String(w * 16).padStart(3, "0")}` : "";
      lines.push(`"${f.name}" "${ipsName}"${offTag} CRC(${hex8(f.origCrc).toLowerCase()})`);
    }
  });
  // the first description line is the title; a line starting with "[" would end the section
  const text = [hackName.trim() || safe, ...description.trim().split(/\r?\n/).filter((l) => l.trim())].map((l) => l.replace(/^\[/, "("));
  const dat = [...lines, "", "[en_US]", ...text, ""].join("\r\n");
  obj[dir + `${safe}.dat`] = new TextEncoder().encode(dat);
  return zipSync(obj, { level: 6 });
}

export function applyIps(target: Uint8Array, ips: Uint8Array): Uint8Array {
  const dec = new TextDecoder();
  if (dec.decode(ips.subarray(0, 5)) !== "PATCH") throw new Error("not an IPS file");
  let out = new Uint8Array(target);
  let p = 5;
  while (p + 3 <= ips.length) {
    if (dec.decode(ips.subarray(p, p + 3)) === "EOF") break;
    const off = (ips[p] << 16) | (ips[p + 1] << 8) | ips[p + 2];
    let len = (ips[p + 3] << 8) | ips[p + 4];
    p += 5;
    let chunk: Uint8Array;
    if (len === 0) {
      len = (ips[p] << 8) | ips[p + 1];
      chunk = new Uint8Array(len).fill(ips[p + 2]);
      p += 3;
    } else {
      chunk = ips.subarray(p, p + len);
      p += len;
    }
    if (off + len > out.length) {
      const bigger = new Uint8Array(off + len);
      bigger.set(out);
      out = bigger;
    }
    out.set(chunk, off);
  }
  return out;
}

// ---------- project files (edits that can be re-applied to a clean set) ----------

export interface ProjectFile {
  app: "neogeo-hackrom-studio";
  version: 1;
  setName: string;
  notes: string;
  bookmarks: { addr: number; bank: number; name: string }[];
  files: { name: string; crc: string; patches: { offset: number; hex: string }[] }[];
}

export function makeProject(rs: RomSet, notes: string, bookmarks: ProjectFile["bookmarks"]): ProjectFile {
  return {
    app: "neogeo-hackrom-studio",
    version: 1,
    setName: rs.setName,
    notes,
    bookmarks,
    files: rs.files
      .map((f, i) => ({
        name: f.name,
        crc: hex8(f.origCrc),
        patches: rs.diff(i).map((d) => ({
          offset: d.offset,
          hex: Array.from(f.data.subarray(d.offset, d.offset + d.length), (b) => b.toString(16).padStart(2, "0")).join(""),
        })),
      }))
      .filter((f) => f.patches.length),
  };
}

export function applyProject(rs: RomSet, p: ProjectFile): string[] {
  const warnings: string[] = [];
  rs.batch("load project", () => {
    for (const pf of p.files) {
      const idx = rs.files.findIndex((f) => f.name.toLowerCase() === pf.name.toLowerCase());
      if (idx < 0) {
        warnings.push(tr("file {name} not in this ROM set", { name: pf.name }));
        continue;
      }
      if (hex8(rs.files[idx].origCrc) !== pf.crc) warnings.push(tr("{name}: CRC differs from the one the project was made with", { name: pf.name }));
      for (const patch of pf.patches) {
        const bytes = new Uint8Array(patch.hex.length / 2);
        for (let k = 0; k < bytes.length; k++) bytes[k] = parseInt(patch.hex.substr(k * 2, 2), 16);
        rs.write(idx, patch.offset, bytes, "project");
      }
    }
  });
  return warnings;
}

export function crcReport(rs: RomSet, keepCrc = false) {
  return rs.files.map((f, i) => ({ name: f.name, original: hex8(f.origCrc), current: hex8(crc32(exportFileBytes(rs, i, keepCrc).bytes)), modified: rs.isModified(i) }));
}
