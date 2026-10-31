// A loaded Neo Geo ROM set: files, roles, CPU address mapping, edits and undo.
import { crc32, hex6, swap16 } from "./bytes";
import { isKof98EncryptedP1, kof98Decrypt, kof98Encrypt } from "./kof98crypt";
import { isKof2002P2, isKof2002bGfx, kof2002bGfxDescramble, kof2002bGfxScramble, kof2002Descramble, kof2002Scramble } from "./kof2002crypt";

export type RomRole = "p" | "s" | "c" | "m" | "v" | "other";

export interface RomFile {
  name: string;
  role: RomRole;
  /** number parsed from the file name (p1 -> 1, c3 -> 3, v2 -> 2) */
  num: number;
  /** current bytes. Program ROMs are kept big-endian (68k view) internally. */
  data: Uint8Array;
  /** bytes as loaded (same byte order as data) */
  orig: Uint8Array;
  /** true when the file on disk is word-swapped relative to the 68k view (MAME .p1/.p2 dumps usually are) */
  swapped: boolean;
  origCrc: number;
  /** encrypted/scrambled dumps: data/orig hold the plain view; raw is the dump as loaded (68k byte order),
   *  kept only for KOF98 whose encryption needs the unused words back (the others are rebuilt from orig) */
  cipher?: { kind: "kof98" | "kof2002" | "kof2002b-gfx"; raw: Uint8Array };
}

export interface Edit {
  file: number;
  offset: number;
  before: Uint8Array;
  after: Uint8Array;
  label: string;
  time: number;
  /** set on compound (batched) edits */
  parts?: Edit[];
}

export interface CpuLoc {
  file: number;
  offset: number;
}

const MB = 0x100000;

/** BIOS and system files some sets bundle (they must not be taken for program/fix ROMs). */
const BIOS_FILE = /^(sp-|sp1\.|uni-bios|vs-bios|asia-|japan-|usa_|sm1\.|sfix\.|000-lo|neo-epo|neo-po|aes-|neodebug)/;

export function classify(name: string): { role: RomRole; num: number } {
  const base = name.toLowerCase().split(/[\\/]/).pop() ?? name.toLowerCase();
  if (BIOS_FILE.test(base)) return { role: "other", num: 0 };
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
  const tryPart = (s: string): { role: RomRole; num: number } | null => {
    let m = s.match(/^(?:s?p|ep|pn|pg|pk|pr|pb)(\d+)$/);
    if (m) return { role: "p", num: +m[1] };
    m = s.match(/^c(\d+)$/);
    if (m) return { role: "c", num: +m[1] };
    m = s.match(/^s(\d+)$/);
    if (m) return { role: "s", num: +m[1] };
    m = s.match(/^m(\d+)$/);
    if (m) return { role: "m", num: +m[1] };
    m = s.match(/^v(\d+)$/);
    if (m) return { role: "v", num: +m[1] };
    return null;
  };
  const fromExt = tryPart(ext);
  if (fromExt) return fromExt;
  // e.g. "kof97_p1.rom", "232-c1.bin"
  const stem = base.slice(0, base.length - (ext ? ext.length + 1 : 0));
  const parts = stem.split(/[-_ .]/).reverse();
  for (const p of parts) {
    const r = tryPart(p);
    if (r) return r;
  }
  return { role: "other", num: 0 };
}

const HEADER = "NEO-GEO";
function headerAt(b: Uint8Array, off: number): "be" | "le" | null {
  if (b.length < off + 8) return null;
  const be = String.fromCharCode(...b.subarray(off, off + 7));
  if (be === HEADER) return "be";
  const sw = String.fromCharCode(b[off + 1], b[off], b[off + 3], b[off + 2], b[off + 5], b[off + 4], b[off + 7]);
  if (sw === HEADER) return "le";
  return null;
}

type Listener = () => void;

export class RomSet {
  files: RomFile[] = [];
  setName = "romset";
  undoStack: Edit[] = [];
  redoStack: Edit[] = [];
  /** P1 file index, and which half of a 2MB P1 is mapped at 0x000000 */
  p1 = -1;
  p1FixedOffset = 0;
  /** 1MB banks visible at 0x200000 (bank switch via $2FFFF0 on most carts) */
  banks: CpuLoc[] = [];
  version = 0;
  private listeners = new Set<Listener>();

  static fromFiles(setName: string, entries: { name: string; data: Uint8Array }[]): RomSet {
    const rs = new RomSet();
    rs.setName = setName;
    // detect swapping from P1 header
    const classified = entries
      .map((e) => ({ ...e, ...classify(e.name) }))
      .filter((e) => e.data.length > 0);
    const progs = classified.filter((e) => e.role === "p").sort((a, b) => a.num - b.num);
    let swapped = true;
    for (const p of progs) {
      const h = headerAt(p.data, 0x100) ?? headerAt(p.data, MB + 0x100);
      if (h) {
        swapped = h === "le";
        break;
      }
    }
    // NGH from the P1 header (needed to recognise game specific program scrambles)
    let ngh = -1;
    for (const p of progs) {
      const d = swapped ? swap16(p.data.subarray(0, 0x110)) : p.data;
      if (headerAt(d, 0x100) === "be") {
        ngh = (d[0x108] << 8) | d[0x109];
        break;
      }
    }
    for (const e of classified) {
      let data = e.data;
      const isProg = e.role === "p";
      if (isProg && swapped) data = swap16(data);
      const origCrc = crc32(e.data);
      let cipher: RomFile["cipher"];
      if (isProg && isKof98EncryptedP1(data, origCrc)) {
        cipher = { kind: "kof98", raw: new Uint8Array(data) };
        data = kof98Decrypt(data);
      } else if (isProg && isKof2002P2(data, ngh)) {
        cipher = { kind: "kof2002", raw: new Uint8Array(0) };
        data = kof2002Descramble(data);
      } else if (e.role === "c" && isKof2002bGfx(e.name, ngh)) {
        cipher = { kind: "kof2002b-gfx", raw: new Uint8Array(0) }; // rebuilt from orig when needed
        data = kof2002bGfxDescramble(data);
      }
      rs.files.push({
        name: e.name,
        role: e.role,
        num: e.num,
        data: new Uint8Array(data),
        orig: new Uint8Array(data),
        swapped: isProg && swapped,
        origCrc,
        cipher,
      });
    }
    const roleOrder: Record<RomRole, number> = { p: 0, s: 1, c: 2, m: 3, v: 4, other: 5 };
    rs.files.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || a.num - b.num || a.name.localeCompare(b.name));
    rs.computeMapping();
    return rs;
  }

  computeMapping() {
    const progs = this.files.map((f, i) => ({ f, i })).filter((x) => x.f.role === "p");
    this.p1 = -1;
    this.banks = [];
    if (!progs.length) return;
    // P1 is the program ROM holding the NEO-GEO header
    let p1 = progs.find((x) => headerAt(x.f.data, 0x100) === "be");
    let fixedOff = 0;
    if (!p1) {
      p1 = progs.find((x) => headerAt(x.f.data, MB + 0x100) === "be");
      if (p1) fixedOff = MB;
    }
    if (!p1) p1 = progs[0];
    this.p1 = p1.i;
    this.p1FixedOffset = fixedOff;
    const others = progs.filter((x) => x.i !== p1!.i);
    if (others.length) {
      for (const o of others)
        for (let off = 0; off < o.f.data.length; off += MB) this.banks.push({ file: o.i, offset: off });
    } else if (p1.f.data.length > MB) {
      // 2MB P1: the half not at 0x000000 is the bank window
      for (let off = 0; off < p1.f.data.length; off += MB) if (off !== fixedOff) this.banks.push({ file: p1.i, offset: off });
    }
  }

  get p1File(): RomFile | null {
    return this.p1 >= 0 ? this.files[this.p1] : null;
  }

  /** Map a 68k address to a file location. `bank` selects the 1MB page shown at 0x200000. */
  cpuToFile(addr: number, bank = 0): CpuLoc | null {
    addr &= 0xffffff;
    if (addr < MB) {
      if (this.p1 < 0) return null;
      const off = this.p1FixedOffset + addr;
      return off < this.files[this.p1].data.length ? { file: this.p1, offset: off } : null;
    }
    if (addr >= 0x200000 && addr < 0x300000) {
      const b = this.banks[bank];
      if (!b) return null;
      const off = b.offset + (addr - 0x200000);
      return off < this.files[b.file].data.length ? { file: b.file, offset: off } : null;
    }
    return null;
  }

  /** Reverse map a program file location to its 68k address + bank. */
  fileToCpu(file: number, offset: number): { addr: number; bank: number } | null {
    if (file === this.p1 && offset >= this.p1FixedOffset && offset < this.p1FixedOffset + MB)
      return { addr: offset - this.p1FixedOffset, bank: -1 };
    for (let i = 0; i < this.banks.length; i++) {
      const b = this.banks[i];
      if (b.file === file && offset >= b.offset && offset < b.offset + MB) return { addr: 0x200000 + offset - b.offset, bank: i };
    }
    return null;
  }

  /** Find the bank whose first word equals `id` (many SNK games tag banks with 0001, 0002...). */
  bankById(id: number): number {
    for (let i = 0; i < this.banks.length; i++) {
      const b = this.banks[i];
      const d = this.files[b.file].data;
      if (((d[b.offset] << 8) | d[b.offset + 1]) === id) return i;
    }
    return id < this.banks.length ? id : -1;
  }

  read8(addr: number, bank = 0) {
    const l = this.cpuToFile(addr, bank);
    return l ? this.files[l.file].data[l.offset] : 0xff;
  }
  read16(addr: number, bank = 0) {
    return ((this.read8(addr, bank) << 8) | this.read8(addr + 1, bank)) & 0xffff;
  }
  read32(addr: number, bank = 0) {
    return ((this.read16(addr, bank) << 16) | this.read16(addr + 2, bank)) >>> 0;
  }
  readBytes(addr: number, len: number, bank = 0): Uint8Array {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = this.read8(addr + i, bank);
    return out;
  }

  /** Returns a reader function for the given bank (used by the disassembler). */
  reader(bank = 0) {
    return (addr: number) => this.read8(addr, bank);
  }

  filesByRole(role: RomRole) {
    return this.files.map((f, i) => ({ f, i })).filter((x) => x.f.role === role);
  }

  // ---------- editing ----------

  write(file: number, offset: number, bytes: ArrayLike<number>, label = "edit") {
    const f = this.files[file];
    if (!f) throw new Error("bad file index");
    if (offset < 0 || offset + bytes.length > f.data.length) throw new Error(`write out of range in ${f.name} @${hex6(offset)}`);
    const before = f.data.slice(offset, offset + bytes.length);
    const after = Uint8Array.from(bytes);
    let same = true;
    for (let i = 0; i < after.length; i++) if (before[i] !== after[i]) same = false;
    if (same) return;
    f.data.set(after, offset);
    this.undoStack.push({ file, offset, before, after, label, time: Date.now() });
    if (this.undoStack.length > 2000) this.undoStack.shift();
    this.redoStack = [];
    this.bump();
  }

  writeCpu(addr: number, bytes: ArrayLike<number>, bank = 0, label = "edit") {
    // split across boundaries if needed (rare)
    const loc = this.cpuToFile(addr, bank);
    const end = this.cpuToFile(addr + bytes.length - 1, bank);
    if (!loc || !end || end.file !== loc.file || end.offset - loc.offset !== bytes.length - 1)
      throw new Error(`address ${hex6(addr)} (+${bytes.length}) is not inside one ROM file`);
    this.write(loc.file, loc.offset, bytes, label);
  }

  /** Group several writes into one undo step. */
  batch(label: string, fn: () => void) {
    const start = this.undoStack.length;
    const silent = this.silence();
    try {
      fn();
    } finally {
      silent();
    }
    const added = this.undoStack.splice(start);
    if (added.length) {
      // one compound undo step; undo applies the parts in reverse
      const parts = added.flatMap((e: any) => (e.parts as Edit[]) ?? [e]);
      this.undoStack.push({ file: -1, offset: 0, before: new Uint8Array(), after: new Uint8Array(), label, time: Date.now(), parts } as Edit);
    }
    this.bump();
  }

  private muted = 0;
  private silence() {
    this.muted++;
    return () => {
      this.muted--;
    };
  }

  undo() {
    const e = this.undoStack.pop() as any;
    if (!e) return;
    const parts: Edit[] = e.parts ?? [e];
    for (let i = parts.length - 1; i >= 0; i--) this.files[parts[i].file].data.set(parts[i].before, parts[i].offset);
    this.redoStack.push(e);
    this.bump();
  }

  redo() {
    const e = this.redoStack.pop() as any;
    if (!e) return;
    const parts: Edit[] = e.parts ?? [e];
    for (const p of parts) this.files[p.file].data.set(p.after, p.offset);
    this.undoStack.push(e);
    this.bump();
  }

  /** Regions where data differs from orig. */
  diff(file: number): { offset: number; length: number }[] {
    const f = this.files[file];
    const out: { offset: number; length: number }[] = [];
    let i = 0;
    const n = f.data.length;
    while (i < n) {
      if (f.data[i] !== f.orig[i]) {
        const start = i;
        while (i < n && f.data[i] !== f.orig[i]) i++;
        out.push({ offset: start, length: i - start });
      } else i++;
    }
    return out;
  }

  isModified(file: number) {
    const f = this.files[file];
    for (let i = 0; i < f.data.length; i++) if (f.data[i] !== f.orig[i]) return true;
    return false;
  }

  /** Bytes of the file in its on-disk byte order. */
  exportBytes(file: number): Uint8Array {
    const f = this.files[file];
    const bytes = !f.cipher
      ? f.data
      : f.cipher.kind === "kof98"
        ? kof98Encrypt(f.data, f.cipher.raw)
        : f.cipher.kind === "kof2002"
          ? kof2002Scramble(f.data)
          : kof2002bGfxScramble(f.data);
    return f.swapped ? swap16(bytes) : bytes;
  }

  /** The file exactly as it was loaded from disk. */
  originalBytes(file: number): Uint8Array {
    const f = this.files[file];
    const bytes = !f.cipher
      ? f.orig
      : f.cipher.kind === "kof98"
        ? f.cipher.raw
        : f.cipher.kind === "kof2002"
          ? kof2002Scramble(f.orig)
          : kof2002bGfxScramble(f.orig);
    return f.swapped ? swap16(bytes) : bytes;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  bump() {
    this.version++;
    if (this.muted) return;
    for (const l of this.listeners) l();
  }
}
