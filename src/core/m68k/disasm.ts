// Motorola 68000 disassembler (complete base 68000 instruction set, Motorola syntax).

export type Reader = (addr: number) => number;

export type InsnKind = "normal" | "branch" | "cond" | "call" | "jump" | "ret" | "invalid";

export interface Insn {
  addr: number;
  size: number;
  mnemonic: string;
  operands: string;
  text: string;
  kind: InsnKind;
  /** resolved branch / jump / absolute target if statically known */
  target?: number;
  /** absolute addresses referenced by operands (abs.w/abs.l/pc-relative data) */
  refs: number[];
  /** true when the encoding depends on its own address (relative branch or PC-relative EA) */
  pcRelative: boolean;
}

const hx = (n: number) => "$" + (n >>> 0).toString(16).toUpperCase();
const SZ = [".b", ".w", ".l"];
const CC = ["t", "f", "hi", "ls", "cc", "cs", "ne", "eq", "vc", "vs", "pl", "mi", "ge", "lt", "gt", "le"];
const BCC = ["ra", "sr", "hi", "ls", "cc", "cs", "ne", "eq", "vc", "vs", "pl", "mi", "ge", "lt", "gt", "le"];

class Cursor {
  pc: number;
  refs: number[] = [];
  pcRel = false;
  constructor(private rd: Reader, public start: number) {
    this.pc = start + 2;
  }
  u16() {
    const v = ((this.rd(this.pc) << 8) | this.rd(this.pc + 1)) & 0xffff;
    this.pc += 2;
    return v;
  }
  s16() {
    const v = this.u16();
    return v >= 0x8000 ? v - 0x10000 : v;
  }
  u32() {
    const hi = this.u16();
    const lo = this.u16();
    return ((hi << 16) | lo) >>> 0;
  }
}

const sext8 = (v: number) => ((v & 0xff) ^ 0x80) - 0x80;
const signedHex = (v: number) => (v < 0 ? "-" + hx(-v) : hx(v));

function brief(c: Cursor, base: string, pcBase?: number): string {
  const ext = c.u16();
  const da = ext & 0x8000 ? "a" : "d";
  const reg = (ext >> 12) & 7;
  const sz = ext & 0x800 ? ".l" : ".w";
  const disp = sext8(ext);
  if (pcBase !== undefined) {
    c.pcRel = true;
    const t = (pcBase + disp) & 0xffffff;
    c.refs.push(t);
    return `(${hx(t)},pc,${da}${reg}${sz})`;
  }
  return `(${signedHex(disp)},${base},${da}${reg}${sz})`;
}

/** Decode effective address. size: 0=b 1=w 2=l (for immediates). */
function ea(c: Cursor, mode: number, reg: number, size: number): string | null {
  switch (mode) {
    case 0:
      return `d${reg}`;
    case 1:
      return `a${reg}`;
    case 2:
      return `(a${reg})`;
    case 3:
      return `(a${reg})+`;
    case 4:
      return `-(a${reg})`;
    case 5: {
      const d = c.s16();
      return `(${signedHex(d)},a${reg})`;
    }
    case 6:
      return brief(c, `a${reg}`);
    case 7:
      switch (reg) {
        case 0: {
          const v = c.s16();
          const a = v & 0xffffff;
          c.refs.push(v < 0 ? (v + 0x1000000) & 0xffffff : v);
          return `(${hx(v & 0xffff)}).w`;
        }
        case 1: {
          const v = c.u32();
          c.refs.push(v & 0xffffff);
          return `(${hx(v)}).l`;
        }
        case 2: {
          const base = c.pc;
          const d = c.s16();
          const t = (base + d) & 0xffffff;
          c.refs.push(t);
          c.pcRel = true;
          return `(${hx(t)},pc)`;
        }
        case 3: {
          const base = c.pc;
          return brief(c, "pc", base);
        }
        case 4: {
          if (size === 0) return `#${hx(c.u16() & 0xff)}`;
          if (size === 1) return `#${hx(c.u16())}`;
          return `#${hx(c.u32())}`;
        }
      }
      return null;
  }
  return null;
}

function movemList(mask: number, predec: boolean): string {
  const regs: string[] = [];
  for (let i = 0; i < 16; i++) {
    const bit = predec ? 15 - i : i;
    if (mask & (1 << bit)) regs.push(i < 8 ? `d${i}` : `a${i - 8}`);
  }
  // compress ranges
  const out: string[] = [];
  let i = 0;
  while (i < regs.length) {
    let j = i;
    while (
      j + 1 < regs.length &&
      regs[j + 1][0] === regs[i][0] &&
      +regs[j + 1][1] === +regs[j][1] + 1
    )
      j++;
    out.push(j > i ? `${regs[i]}-${regs[j]}` : regs[i]);
    i = j + 1;
  }
  return out.join("/") || "0";
}

export function disasm(rd: Reader, addr: number): Insn {
  const c = new Cursor(rd, addr);
  const op = ((rd(addr) << 8) | rd(addr + 1)) & 0xffff;
  let mn = "";
  let ops = "";
  let kind: InsnKind = "normal";
  let target: number | undefined;

  const bad = () => {
    mn = "dc.w";
    ops = hx(op);
    kind = "invalid";
    c.pc = addr + 2;
  };

  const mode = (op >> 3) & 7;
  const reg = op & 7;
  const reg2 = (op >> 9) & 7;
  const sizeBits = (op >> 6) & 3;

  const EA = (m = mode, r = reg, s = sizeBits) => ea(c, m, r, s);

  try {
    switch (op >> 12) {
      case 0x0: {
        if (op === 0x003c) { mn = "ori"; ops = `#${hx(c.u16() & 0xff)},ccr`; break; }
        if (op === 0x007c) { mn = "ori"; ops = `#${hx(c.u16())},sr`; break; }
        if (op === 0x023c) { mn = "andi"; ops = `#${hx(c.u16() & 0xff)},ccr`; break; }
        if (op === 0x027c) { mn = "andi"; ops = `#${hx(c.u16())},sr`; break; }
        if (op === 0x0a3c) { mn = "eori"; ops = `#${hx(c.u16() & 0xff)},ccr`; break; }
        if (op === 0x0a7c) { mn = "eori"; ops = `#${hx(c.u16())},sr`; break; }
        if (op & 0x0100) {
          if (mode === 1) {
            // movep
            const d = c.s16();
            const sz = op & 0x40 ? ".l" : ".w";
            mn = "movep" + sz;
            ops = op & 0x80 ? `d${reg2},(${signedHex(d)},a${reg})` : `(${signedHex(d)},a${reg}),d${reg2}`;
            break;
          }
          const names = ["btst", "bchg", "bclr", "bset"];
          mn = names[sizeBits];
          const e = EA(mode, reg, 0);
          if (!e) return finish(bad());
          ops = `d${reg2},${e}`;
          break;
        }
        const top = (op >> 9) & 7;
        if (top === 4) {
          const names = ["btst", "bchg", "bclr", "bset"];
          mn = names[sizeBits];
          const bit = c.u16() & 0xff;
          const e = EA(mode, reg, 0);
          if (!e) return finish(bad());
          ops = `#${bit},${e}`;
          break;
        }
        const names: Record<number, string> = { 0: "ori", 1: "andi", 2: "subi", 3: "addi", 5: "eori", 6: "cmpi" };
        if (!(top in names) || sizeBits === 3) return finish(bad());
        mn = names[top] + SZ[sizeBits];
        const imm = sizeBits === 0 ? c.u16() & 0xff : sizeBits === 1 ? c.u16() : c.u32();
        const e = EA();
        if (!e) return finish(bad());
        ops = `#${hx(imm)},${e}`;
        break;
      }
      case 0x1:
      case 0x2:
      case 0x3: {
        const sz = op >> 12 === 1 ? 0 : op >> 12 === 3 ? 1 : 2;
        const dmode = (op >> 6) & 7;
        const src = EA(mode, reg, sz);
        if (!src) return finish(bad());
        if (dmode === 1) {
          if (sz === 0) return finish(bad());
          mn = "movea" + SZ[sz];
          ops = `${src},a${reg2}`;
          break;
        }
        const dst = EA(dmode, reg2, sz);
        if (!dst || (dmode === 7 && reg2 > 1)) return finish(bad());
        mn = "move" + SZ[sz];
        ops = `${src},${dst}`;
        break;
      }
      case 0x4: {
        if (op === 0x4e70) { mn = "reset"; break; }
        if (op === 0x4e71) { mn = "nop"; break; }
        if (op === 0x4e72) { mn = "stop"; ops = `#${hx(c.u16())}`; break; }
        if (op === 0x4e73) { mn = "rte"; kind = "ret"; break; }
        if (op === 0x4e75) { mn = "rts"; kind = "ret"; break; }
        if (op === 0x4e76) { mn = "trapv"; break; }
        if (op === 0x4e77) { mn = "rtr"; kind = "ret"; break; }
        if (op === 0x4afc) { mn = "illegal"; break; }
        if ((op & 0xfff0) === 0x4e40) { mn = "trap"; ops = `#${op & 15}`; break; }
        if ((op & 0xfff8) === 0x4e50) { mn = "link"; ops = `a${reg},#${signedHex(c.s16())}`; break; }
        if ((op & 0xfff8) === 0x4e58) { mn = "unlk"; ops = `a${reg}`; break; }
        if ((op & 0xfff0) === 0x4e60) { mn = "move"; ops = op & 8 ? `usp,a${reg}` : `a${reg},usp`; break; }
        if ((op & 0xffc0) === 0x4e80 || (op & 0xffc0) === 0x4ec0) {
          const isJsr = (op & 0xffc0) === 0x4e80;
          mn = isJsr ? "jsr" : "jmp";
          const e = EA(mode, reg, 2);
          if (!e || mode < 2 || mode === 3 || mode === 4) return finish(bad());
          ops = e;
          kind = isJsr ? "call" : "jump";
          if (mode === 7 && (reg === 0 || reg === 1 || reg === 2)) target = c.refs[c.refs.length - 1];
          break;
        }
        if ((op & 0xf1c0) === 0x41c0) {
          const e = EA(mode, reg, 2);
          if (!e) return finish(bad());
          mn = "lea";
          ops = `${e},a${reg2}`;
          break;
        }
        if ((op & 0xf1c0) === 0x4180) {
          const e = EA(mode, reg, 1);
          if (!e) return finish(bad());
          mn = "chk.w";
          ops = `${e},d${reg2}`;
          break;
        }
        if ((op & 0xfb80) === 0x4880 && mode !== 0) {
          // movem
          const sz = op & 0x40 ? ".l" : ".w";
          const mask = c.u16();
          const toMem = !(op & 0x400);
          const e = EA(mode, reg, 1);
          if (!e) return finish(bad());
          mn = "movem" + sz;
          ops = toMem ? `${movemList(mask, mode === 4)},${e}` : `${e},${movemList(mask, false)}`;
          break;
        }
        if ((op & 0xfff8) === 0x4880) { mn = "ext.w"; ops = `d${reg}`; break; }
        if ((op & 0xfff8) === 0x48c0) { mn = "ext.l"; ops = `d${reg}`; break; }
        if ((op & 0xfff8) === 0x4840) { mn = "swap"; ops = `d${reg}`; break; }
        if ((op & 0xffc0) === 0x4840) {
          const e = EA(mode, reg, 2);
          if (!e) return finish(bad());
          mn = "pea";
          ops = e;
          break;
        }
        if ((op & 0xffc0) === 0x4800) { const e = EA(mode, reg, 0); if (!e) return finish(bad()); mn = "nbcd"; ops = e; break; }
        if ((op & 0xffc0) === 0x40c0) { const e = EA(mode, reg, 1); if (!e) return finish(bad()); mn = "move"; ops = `sr,${e}`; break; }
        if ((op & 0xffc0) === 0x44c0) { const e = EA(mode, reg, 1); if (!e) return finish(bad()); mn = "move"; ops = `${e},ccr`; break; }
        if ((op & 0xffc0) === 0x46c0) { const e = EA(mode, reg, 1); if (!e) return finish(bad()); mn = "move"; ops = `${e},sr`; break; }
        if ((op & 0xffc0) === 0x4ac0) { const e = EA(mode, reg, 0); if (!e) return finish(bad()); mn = "tas"; ops = e; break; }
        const grp = (op >> 8) & 0xf;
        const singles: Record<number, string> = { 0x0: "negx", 0x2: "clr", 0x4: "neg", 0x6: "not", 0xa: "tst" };
        if (grp in singles && sizeBits !== 3) {
          const e = EA(mode, reg, sizeBits);
          if (!e) return finish(bad());
          mn = singles[grp] + SZ[sizeBits];
          ops = e;
          break;
        }
        return finish(bad());
      }
      case 0x5: {
        if (sizeBits === 3) {
          const cond = (op >> 8) & 15;
          if (mode === 1) {
            const base = c.pc;
            const d = c.s16();
            target = (base + d) & 0xffffff;
            mn = "db" + (cond === 1 ? "ra" : CC[cond]);
            ops = `d${reg},${hx(target)}`;
            kind = "cond";
            c.pcRel = true;
            break;
          }
          const e = EA(mode, reg, 0);
          if (!e) return finish(bad());
          mn = "s" + CC[cond];
          ops = e;
          break;
        }
        const q = reg2 === 0 ? 8 : reg2;
        const e = EA(mode, reg, sizeBits);
        if (!e) return finish(bad());
        mn = (op & 0x100 ? "subq" : "addq") + SZ[sizeBits];
        ops = `#${q},${e}`;
        break;
      }
      case 0x6: {
        const cond = (op >> 8) & 15;
        let disp = sext8(op);
        const base = addr + 2;
        let suffix = ".s";
        if ((op & 0xff) === 0) {
          disp = c.s16();
          suffix = ".w";
        } else if ((op & 0xff) === 0xff) return finish(bad()); // 68020 .l
        target = (base + disp) & 0xffffff;
        mn = "b" + BCC[cond] + suffix;
        ops = hx(target);
        kind = cond === 0 ? "branch" : cond === 1 ? "call" : "cond";
        c.pcRel = true;
        break;
      }
      case 0x7: {
        if (op & 0x100) return finish(bad());
        mn = "moveq";
        ops = `#${signedHex(sext8(op))},d${reg2}`;
        break;
      }
      case 0x8:
      case 0xc: {
        const isOr = op >> 12 === 8;
        if ((op & 0x1c0) === 0x0c0 || (op & 0x1c0) === 0x1c0) {
          const signed = (op & 0x1c0) === 0x1c0;
          const e = EA(mode, reg, 1);
          if (!e) return finish(bad());
          mn = isOr ? (signed ? "divs.w" : "divu.w") : signed ? "muls.w" : "mulu.w";
          ops = `${e},d${reg2}`;
          break;
        }
        if ((op & 0x1f0) === 0x100) {
          mn = isOr ? "sbcd" : "abcd";
          ops = op & 8 ? `-(a${reg}),-(a${reg2})` : `d${reg},d${reg2}`;
          break;
        }
        if (!isOr && (op & 0x1f8) === 0x140) { mn = "exg"; ops = `d${reg2},d${reg}`; break; }
        if (!isOr && (op & 0x1f8) === 0x148) { mn = "exg"; ops = `a${reg2},a${reg}`; break; }
        if (!isOr && (op & 0x1f8) === 0x188) { mn = "exg"; ops = `d${reg2},a${reg}`; break; }
        const e = EA(mode, reg, sizeBits);
        if (!e) return finish(bad());
        mn = (isOr ? "or" : "and") + SZ[sizeBits];
        ops = op & 0x100 ? `d${reg2},${e}` : `${e},d${reg2}`;
        break;
      }
      case 0x9:
      case 0xd: {
        const name = op >> 12 === 9 ? "sub" : "add";
        if (sizeBits === 3) {
          const sz = op & 0x100 ? 2 : 1;
          const e = EA(mode, reg, sz);
          if (!e) return finish(bad());
          mn = name + "a" + SZ[sz];
          ops = `${e},a${reg2}`;
          break;
        }
        if ((op & 0x130) === 0x100) {
          mn = name + "x" + SZ[sizeBits];
          ops = op & 8 ? `-(a${reg}),-(a${reg2})` : `d${reg},d${reg2}`;
          break;
        }
        const e = EA(mode, reg, sizeBits);
        if (!e) return finish(bad());
        mn = name + SZ[sizeBits];
        ops = op & 0x100 ? `d${reg2},${e}` : `${e},d${reg2}`;
        break;
      }
      case 0xb: {
        if (sizeBits === 3) {
          const sz = op & 0x100 ? 2 : 1;
          const e = EA(mode, reg, sz);
          if (!e) return finish(bad());
          mn = "cmpa" + SZ[sz];
          ops = `${e},a${reg2}`;
          break;
        }
        if (op & 0x100) {
          if (mode === 1) {
            mn = "cmpm" + SZ[sizeBits];
            ops = `(a${reg})+,(a${reg2})+`;
            break;
          }
          const e = EA(mode, reg, sizeBits);
          if (!e) return finish(bad());
          mn = "eor" + SZ[sizeBits];
          ops = `d${reg2},${e}`;
          break;
        }
        const e = EA(mode, reg, sizeBits);
        if (!e) return finish(bad());
        mn = "cmp" + SZ[sizeBits];
        ops = `${e},d${reg2}`;
        break;
      }
      case 0xe: {
        const names = ["as", "ls", "rox", "ro"];
        const dir = op & 0x100 ? "l" : "r";
        if (sizeBits === 3) {
          const e = EA(mode, reg, 1);
          if (!e) return finish(bad());
          mn = names[(op >> 9) & 3] + dir + ".w";
          ops = e;
          break;
        }
        const type = (op >> 3) & 3;
        mn = names[type] + dir + SZ[sizeBits];
        const cnt = op & 0x20 ? `d${reg2}` : `#${reg2 === 0 ? 8 : reg2}`;
        ops = `${cnt},d${reg}`;
        break;
      }
      default:
        bad();
    }
  } catch {
    bad();
  }
  return finish();

  function finish(_?: unknown): Insn {
    const size = c.pc - addr;
    const text = ops ? `${mn.padEnd(9)}${ops}` : mn;
    return {
      addr,
      size,
      mnemonic: mn,
      operands: ops,
      text,
      kind,
      target,
      refs: kind === "invalid" ? [] : c.refs,
      pcRelative: c.pcRel,
    };
  }
}

/** Disassemble a linear range. */
export function disasmRange(rd: Reader, start: number, count: number): Insn[] {
  const out: Insn[] = [];
  let a = start;
  for (let i = 0; i < count; i++) {
    const ins = disasm(rd, a);
    out.push(ins);
    a += ins.size;
  }
  return out;
}

/** Follow code from an entry point (recursive descent) and return discovered instruction addresses. */
export function traceCode(rd: Reader, entries: number[], limit = 20000, inRange = (a: number) => a < 0x100000): Map<number, Insn> {
  const seen = new Map<number, Insn>();
  const work = [...entries];
  const rd32 = (a: number) => ((rd(a) << 24) | (rd(a + 1) << 16) | (rd(a + 2) << 8) | rd(a + 3)) >>> 0;
  while (work.length && seen.size < limit) {
    let a = work.pop()!;
    let tableBase: { reg: string; addr: number } | null = null;
    while (inRange(a) && !seen.has(a) && seen.size < limit) {
      const ins = disasm(rd, a);
      seen.set(a, ins);
      if (ins.kind === "invalid") break;
      // jump tables: lea table,aN ... movea.l (0,aN,dN),aN / jsr (aN)
      const lea = ins.mnemonic === "lea" ? ins.operands.match(/^\(\$([0-9A-F]+)(?:\)\.l|,pc\)),(a\d)$/) : null;
      if (lea) tableBase = { reg: lea[2], addr: parseInt(lea[1], 16) };
      else if (tableBase && ins.mnemonic === "movea.l" && ins.operands.startsWith(`($0,${tableBase.reg},`)) {
        for (let k = 0; k < 32; k++) {
          const p = rd32(tableBase.addr + k * 4);
          if (!p || p & 1 || p > 0xffffff) break;
          if (inRange(p)) work.push(p); // BIOS / other-bank entries are skipped but don't end the table
        }
        tableBase = null;
      }
      if (ins.target !== undefined && inRange(ins.target)) work.push(ins.target);
      if (ins.kind === "ret" || ins.kind === "branch" || ins.kind === "jump") break;
      a += ins.size;
    }
  }
  return seen;
}
