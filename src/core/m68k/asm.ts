// A small two-pass 68000 assembler for patches, hooks and new move routines.
// Supports the common instruction set with Motorola syntax, labels, dc.b/dc.w/dc.l and equ.

export interface AsmResult {
  bytes: Uint8Array;
  labels: Record<string, number>;
  errors: { line: number; message: string }[];
  listing: { line: number; addr: number; bytes: number[]; src: string }[];
}

type Size = 0 | 1 | 2; // b w l

interface EA {
  mode: number;
  reg: number;
  ext: number[]; // extension words
  kind: "dn" | "an" | "ind" | "postinc" | "predec" | "disp" | "index" | "absw" | "absl" | "pcdisp" | "pcindex" | "imm";
  value?: number;
}

class AsmError extends Error {}

const CONDS: Record<string, number> = {
  t: 0, f: 1, hi: 2, ls: 3, cc: 4, hs: 4, cs: 5, lo: 5, ne: 6, eq: 7, vc: 8, vs: 9, pl: 10, mi: 11, ge: 12, lt: 13, gt: 14, le: 15,
};

function splitOperands(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = "", quote = false;
  for (const ch of s) {
    if (ch === "'" || ch === '"') quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

export function assemble(source: string, origin: number, externalLabels: Record<string, number> = {}): AsmResult {
  const lines = source.split(/\r?\n/);
  const errors: AsmResult["errors"] = [];
  let labels: Record<string, number> = { ...lowerKeys(externalLabels) };
  let out: number[] = [];
  let listing: AsmResult["listing"] = [];

  for (let pass = 0; pass < 2; pass++) {
    out = [];
    listing = [];
    let pc = origin;
    const final = pass === 1;
    lines.forEach((raw, li) => {
      let line = raw.replace(/;.*$/, "").replace(/\s\*.*$/, "");
      if (/^\s*\*/.test(line)) line = "";
      if (!line.trim()) return;
      // labels
      const lm = line.match(/^\s*([A-Za-z_.][\w.]*):/) ?? line.match(/^([A-Za-z_.][\w.]*)\s+(?=\S)/);
      let rest = line;
      if (lm && (line.match(/^\s*([A-Za-z_.][\w.]*):/) || !isMnemonic(lm[1]))) {
        const name = lm[1].toLowerCase();
        rest = line.slice(lm[0].length);
        // "name equ value"
        const eq = rest.match(/^\s*(equ|=)\s+(.+)$/i);
        if (eq) {
          try {
            labels[name] = evalExpr(eq[2], labels, pc, !final);
          } catch (e: any) {
            if (final) errors.push({ line: li + 1, message: e.message });
          }
          return;
        }
        labels[name] = pc;
      }
      rest = rest.trim();
      if (!rest) return;
      const m = rest.match(/^([A-Za-z]+)(?:\.([bwls]))?\s*(.*)$/);
      if (!m) {
        if (final) errors.push({ line: li + 1, message: `cannot parse "${rest}"` });
        return;
      }
      const mnem = m[1].toLowerCase();
      const sfx = (m[2] ?? "").toLowerCase();
      const ops = splitOperands(m[3] ?? "");
      try {
        const words = encode(mnem, sfx, ops, pc, labels, !final);
        if (final) listing.push({ line: li + 1, addr: pc, bytes: words, src: raw });
        out.push(...words);
        pc += words.length;
      } catch (e: any) {
        if (final) errors.push({ line: li + 1, message: e.message });
        // keep sizes stable in pass 1: assume 2 bytes
        if (!final) pc += 2;
      }
    });
  }
  return { bytes: Uint8Array.from(out), labels, errors, listing };
}

function lowerKeys(o: Record<string, number>) {
  const r: Record<string, number> = {};
  for (const k in o) r[k.toLowerCase()] = o[k];
  return r;
}

const MNEMONICS = new Set(
  "move movea moveq lea pea clr tst neg negx not ext swap add adda addi addq sub suba subi subq and andi or ori eor eori cmp cmpa cmpi cmpm btst bset bclr bchg jsr jmp bra bsr rts rte rtr nop movem lsl lsr asl asr rol ror roxl roxr mulu muls divu divs exg trap dc ds even illegal tas link unlk stop reset chk".split(
    " ",
  ),
);
function isMnemonic(s: string) {
  const l = s.toLowerCase().split(".")[0];
  if (MNEMONICS.has(l)) return true;
  if (/^b(ra|sr|hi|ls|cc|hs|cs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(l)) return true;
  if (/^db(ra|t|f|hi|ls|cc|hs|cs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(l)) return true;
  if (/^s(t|f|hi|ls|cc|hs|cs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/.test(l)) return true;
  return false;
}

// ---------------- expressions ----------------

function evalExpr(expr: string, labels: Record<string, number>, pc: number, lenient: boolean): number {
  const toks = expr.trim().match(/\$[0-9a-f]+|0x[0-9a-f]+|%[01]+|\d+|[A-Za-z_.][\w.]*|\*|<<|>>|[-+*/&|^~()]/gi);
  if (!toks) throw new AsmError(`bad expression "${expr}"`);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const prim = (): number => {
    const t = next();
    if (t === undefined) throw new AsmError(`bad expression "${expr}"`);
    if (t === "(") {
      const v = orx();
      if (next() !== ")") throw new AsmError("missing )");
      return v;
    }
    if (t === "-") return -prim();
    if (t === "+") return prim();
    if (t === "~") return ~prim();
    if (t === "*") return pc;
    if (/^\$/.test(t)) return parseInt(t.slice(1), 16);
    if (/^0x/i.test(t)) return parseInt(t.slice(2), 16);
    if (/^%/.test(t)) return parseInt(t.slice(1), 2);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const k = t.toLowerCase();
    if (k in labels) return labels[k];
    if (lenient) return 0;
    throw new AsmError(`unknown label "${t}"`);
  };
  const mul = (): number => {
    let v = prim();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * prim() : Math.trunc(v / prim());
    return v;
  };
  const add = (): number => {
    let v = mul();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + mul() : v - mul();
    return v;
  };
  const shift = (): number => {
    let v = add();
    while (peek() === "<<" || peek() === ">>") v = next() === "<<" ? v << add() : v >>> add();
    return v;
  };
  const andx = (): number => {
    let v = shift();
    while (peek() === "&") {
      next();
      v &= shift();
    }
    return v;
  };
  const orx = (): number => {
    let v = andx();
    while (peek() === "|" || peek() === "^") v = next() === "|" ? v | andx() : v ^ andx();
    return v;
  };
  const v = orx();
  if (i < toks.length) throw new AsmError(`unexpected "${toks[i]}" in "${expr}"`);
  return v;
}

// ---------------- operands ----------------

function regNum(s: string): { a: boolean; n: number } | null {
  const l = s.toLowerCase().trim();
  if (l === "sp") return { a: true, n: 7 };
  const m = l.match(/^([da])([0-7])$/);
  return m ? { a: m[1] === "a", n: +m[2] } : null;
}

function parseEA(op: string, size: Size, labels: Record<string, number>, pc: number, lenient: boolean, extPc: number): EA {
  const s = op.trim();
  const l = s.toLowerCase();
  const r = regNum(l);
  if (r) return r.a ? { mode: 1, reg: r.n, ext: [], kind: "an" } : { mode: 0, reg: r.n, ext: [], kind: "dn" };
  if (s.startsWith("#")) {
    const v = evalExpr(s.slice(1), labels, pc, lenient);
    const ext = size === 2 ? [(v >>> 16) & 0xffff, v & 0xffff] : size === 1 ? [v & 0xffff] : [v & 0xff];
    return { mode: 7, reg: 4, ext, kind: "imm", value: v };
  }
  let m = l.match(/^\((a[0-7]|sp)\)$/);
  if (m) return { mode: 2, reg: regNum(m[1])!.n, ext: [], kind: "ind" };
  m = l.match(/^\((a[0-7]|sp)\)\+$/);
  if (m) return { mode: 3, reg: regNum(m[1])!.n, ext: [], kind: "postinc" };
  m = l.match(/^-\((a[0-7]|sp)\)$/);
  if (m) return { mode: 4, reg: regNum(m[1])!.n, ext: [], kind: "predec" };
  // (d,An) / d(An) / (d,An,Xn) / d(An,Xn) / (d,pc) / d(pc) / (d,pc,Xn)
  let inner: string | null = null, disp = "0";
  m = s.match(/^\((.*)\)$/);
  if (m && m[1].includes(",")) inner = m[1];
  else {
    const m2 = s.match(/^(.+?)\(([^()]*)\)$/);
    if (m2 && /^(a[0-7]|sp|pc)(,|$)/i.test(m2[2].trim())) {
      disp = m2[1];
      inner = m2[2];
    }
  }
  if (inner !== null) {
    let parts = inner.split(",").map((x) => x.trim());
    if (!/^(a[0-7]|sp|pc)$/i.test(parts[0])) {
      disp = parts[0];
      parts = parts.slice(1);
    }
    const base = parts[0].toLowerCase();
    const idx = parts[1];
    if (base === "pc") {
      const target = evalExpr(disp, labels, pc, lenient);
      const d = target - extPc; // displacement is relative to the extension word address
      if (!idx) {
        if (!lenient && (d < -32768 || d > 32767)) throw new AsmError("pc displacement out of range");
        return { mode: 7, reg: 2, ext: [d & 0xffff], kind: "pcdisp" };
      }
      return { mode: 7, reg: 3, ext: [briefExt(idx, d, lenient)], kind: "pcindex" };
    }
    const an = regNum(base);
    if (!an || !an.a) throw new AsmError(`bad base register in "${s}"`);
    const dv = evalExpr(disp, labels, pc, lenient);
    if (!idx) {
      if (dv < -32768 || dv > 65535) throw new AsmError("displacement out of range");
      return { mode: 5, reg: an.n, ext: [dv & 0xffff], kind: "disp" };
    }
    return { mode: 6, reg: an.n, ext: [briefExt(idx, dv, lenient)], kind: "index" };
  }
  // absolute
  let txt = s, forceW = false, forceL = false;
  m = s.match(/^\((.+)\)\.([wl])$/i) ?? s.match(/^(.+)\.([wl])$/i);
  if (m) {
    txt = m[1];
    forceW = m[2].toLowerCase() === "w";
    forceL = !forceW;
  } else if (/^\(.+\)$/.test(s)) txt = s.slice(1, -1);
  const v = evalExpr(txt, labels, pc, lenient);
  if (forceW) return { mode: 7, reg: 0, ext: [v & 0xffff], kind: "absw", value: v };
  return { mode: 7, reg: 1, ext: [(v >>> 16) & 0xffff, v & 0xffff], kind: "absl", value: v };
}

function briefExt(idx: string, d: number, lenient: boolean): number {
  const m = idx.toLowerCase().match(/^([da][0-7]|sp)(?:\.([wl]))?$/);
  if (!m) throw new AsmError(`bad index register "${idx}"`);
  const r = regNum(m[1])!;
  if (!lenient && (d < -128 || d > 127)) throw new AsmError("index displacement out of range (-128..127)");
  return (r.a ? 0x8000 : 0) | (r.n << 12) | (m[2] === "l" ? 0x800 : 0) | (d & 0xff);
}

const sizeOf = (sfx: string, def: Size = 1): Size => (sfx === "b" ? 0 : sfx === "l" ? 2 : sfx === "w" ? 1 : def);
const SZ2 = [0, 1, 2]; // size field for most ops (00 b, 01 w, 10 l)

function regList(s: string): number {
  let mask = 0;
  for (const part of s.split("/")) {
    const [a, b] = part.split("-").map((x) => regNum(x));
    if (!a) throw new AsmError(`bad register list "${s}"`);
    const ai = a.n + (a.a ? 8 : 0);
    const bi = b ? b.n + (b.a ? 8 : 0) : ai;
    for (let i = ai; i <= bi; i++) mask |= 1 << i;
  }
  return mask;
}

function words(...ws: number[]): number[] {
  const out: number[] = [];
  for (const w of ws) out.push((w >> 8) & 0xff, w & 0xff);
  return out;
}

function encode(mnem: string, sfx: string, ops: string[], pc: number, labels: Record<string, number>, lenient: boolean): number[] {
  const need = (n: number) => {
    if (ops.length !== n) throw new AsmError(`${mnem} expects ${n} operand(s)`);
  };
  // extension word addresses: first ext word starts at pc+2
  const E = (op: string, size: Size, extPc = pc + 2) => parseEA(op, size, labels, pc, lenient, extPc);
  const eaBits = (e: EA) => (e.mode << 3) | e.reg;

  // directives
  if (mnem === "dc") {
    const sz = sizeOf(sfx, 1);
    const out: number[] = [];
    for (const o of ops) {
      const str = o.match(/^['"](.*)['"]$/);
      if (str && sz === 0) {
        for (const ch of str[1]) out.push(ch.charCodeAt(0) & 0xff);
        continue;
      }
      const v = evalExpr(o, labels, pc, lenient);
      if (sz === 0) out.push(v & 0xff);
      else if (sz === 1) out.push(...words(v & 0xffff));
      else out.push(...words((v >>> 16) & 0xffff, v & 0xffff));
    }
    if (sz === 0 && out.length & 1) out.push(0); // keep word alignment
    return out;
  }
  if (mnem === "ds") {
    const n = evalExpr(ops[0], labels, pc, lenient) * (sfx === "b" ? 1 : sfx === "l" ? 4 : 2);
    return new Array(n + (n & 1)).fill(0);
  }
  if (mnem === "even") return pc & 1 ? [0] : [];

  const simple: Record<string, number> = { nop: 0x4e71, rts: 0x4e75, rte: 0x4e73, rtr: 0x4e77, illegal: 0x4afc, reset: 0x4e70 };
  if (mnem in simple) return words(simple[mnem]);
  if (mnem === "trap") {
    need(1);
    return words(0x4e40 | (evalExpr(ops[0].replace("#", ""), labels, pc, lenient) & 15));
  }

  // branches
  let bm = mnem.match(/^b(ra|sr|hi|ls|cc|hs|cs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/);
  if (bm) {
    need(1);
    const cond = bm[1] === "ra" ? 0 : bm[1] === "sr" ? 1 : CONDS[bm[1]];
    const target = evalExpr(ops[0], labels, pc, lenient);
    const d = target - (pc + 2);
    if (sfx === "s" || sfx === "b") {
      if (!lenient && (d < -128 || d > 127 || d === 0)) throw new AsmError("short branch out of range (use .w)");
      return words(0x6000 | (cond << 8) | (d & 0xff));
    }
    if (!lenient && (d < -32768 || d > 32767)) throw new AsmError("branch out of range; use jmp/jsr");
    return words(0x6000 | (cond << 8), d & 0xffff);
  }
  bm = mnem.match(/^db(ra|t|f|hi|ls|cc|hs|cs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/);
  if (bm) {
    need(2);
    const cond = bm[1] === "ra" ? 1 : CONDS[bm[1]];
    const r = regNum(ops[0]);
    if (!r || r.a) throw new AsmError("dbcc needs a data register");
    const d = evalExpr(ops[1], labels, pc, lenient) - (pc + 2);
    return words(0x50c8 | (cond << 8) | r.n, d & 0xffff);
  }
  bm = mnem.match(/^s(t|f|hi|ls|cc|hs|cs|lo|ne|eq|vc|vs|pl|mi|ge|lt|gt|le)$/);
  if (bm && ops.length === 1) {
    const e = E(ops[0], 0);
    return words(0x50c0 | (CONDS[bm[1]] << 8) | eaBits(e), ...e.ext);
  }

  switch (mnem) {
    case "move":
    case "movea": {
      need(2);
      const sz = sizeOf(sfx);
      const sl = ops[1].toLowerCase();
      if (sl === "sr" || sl === "ccr") {
        const s = E(ops[0], 1);
        return words((sl === "sr" ? 0x46c0 : 0x44c0) | eaBits(s), ...s.ext);
      }
      if (ops[0].toLowerCase() === "sr") {
        const d = E(ops[1], 1);
        return words(0x40c0 | eaBits(d), ...d.ext);
      }
      const s = E(ops[0], sz);
      const d = E(ops[1], sz, pc + 2 + s.ext.length * 2);
      const szCode = sz === 0 ? 1 : sz === 1 ? 3 : 2;
      if (d.kind === "an" && sz === 0) throw new AsmError("move.b to address register not allowed");
      return words((szCode << 12) | (d.reg << 9) | (d.mode << 6) | eaBits(s), ...s.ext, ...d.ext);
    }
    case "moveq": {
      need(2);
      const v = evalExpr(ops[0].replace(/^#/, ""), labels, pc, lenient);
      const r = regNum(ops[1]);
      if (!r || r.a) throw new AsmError("moveq needs a data register");
      if (!lenient && (v < -128 || v > 255)) throw new AsmError("moveq value out of range");
      return words(0x7000 | (r.n << 9) | (v & 0xff));
    }
    case "lea":
    case "pea":
    case "jsr":
    case "jmp": {
      const e = E(ops[0], 2);
      if (mnem === "lea") {
        need(2);
        const r = regNum(ops[1]);
        if (!r || !r.a) throw new AsmError("lea needs an address register");
        return words(0x41c0 | (r.n << 9) | eaBits(e), ...e.ext);
      }
      need(1);
      const base = mnem === "pea" ? 0x4840 : mnem === "jsr" ? 0x4e80 : 0x4ec0;
      return words(base | eaBits(e), ...e.ext);
    }
    case "clr":
    case "tst":
    case "neg":
    case "negx":
    case "not": {
      need(1);
      const sz = sizeOf(sfx);
      const e = E(ops[0], sz);
      const base = { negx: 0x4000, clr: 0x4200, neg: 0x4400, not: 0x4600, tst: 0x4a00 }[mnem]!;
      return words(base | (SZ2[sz] << 6) | eaBits(e), ...e.ext);
    }
    case "tas": {
      const e = E(ops[0], 0);
      return words(0x4ac0 | eaBits(e), ...e.ext);
    }
    case "ext": {
      const r = regNum(ops[0]);
      if (!r || r.a) throw new AsmError("ext needs a data register");
      return words((sfx === "l" ? 0x48c0 : 0x4880) | r.n);
    }
    case "swap": {
      const r = regNum(ops[0]);
      if (!r || r.a) throw new AsmError("swap needs a data register");
      return words(0x4840 | r.n);
    }
    case "link": {
      const r = regNum(ops[0]);
      return words(0x4e50 | r!.n, evalExpr(ops[1].replace("#", ""), labels, pc, lenient) & 0xffff);
    }
    case "unlk":
      return words(0x4e58 | regNum(ops[0])!.n);
    case "stop":
      return words(0x4e72, evalExpr(ops[0].replace("#", ""), labels, pc, lenient) & 0xffff);
    case "addq":
    case "subq": {
      need(2);
      const sz = sizeOf(sfx);
      const v = evalExpr(ops[0].replace(/^#/, ""), labels, pc, lenient);
      if (!lenient && (v < 1 || v > 8)) throw new AsmError("addq/subq value must be 1..8");
      const e = E(ops[1], sz);
      return words(0x5000 | (mnem === "subq" ? 0x100 : 0) | ((v & 7) << 9) | (SZ2[sz] << 6) | eaBits(e), ...e.ext);
    }
    case "addi":
    case "subi":
    case "andi":
    case "ori":
    case "eori":
    case "cmpi": {
      need(2);
      const sz = sizeOf(sfx);
      const s = E(ops[0], sz);
      if (s.kind !== "imm") throw new AsmError(`${mnem} needs an immediate source`);
      const dl = ops[1].toLowerCase();
      const base = { ori: 0x0000, andi: 0x0200, subi: 0x0400, addi: 0x0600, eori: 0x0a00, cmpi: 0x0c00 }[mnem]!;
      if (dl === "ccr") return words(base | 0x3c, s.value! & 0xff);
      if (dl === "sr") return words(base | 0x7c, s.value! & 0xffff);
      const imm = sz === 0 ? [s.ext[0] & 0xff] : s.ext;
      const d = E(ops[1], sz, pc + 2 + imm.length * 2);
      return words(base | (SZ2[sz] << 6) | eaBits(d), ...imm, ...d.ext);
    }
    case "add":
    case "sub":
    case "and":
    case "or":
    case "cmp":
    case "adda":
    case "suba":
    case "cmpa":
    case "eor": {
      need(2);
      const sz = sizeOf(sfx);
      const s = E(ops[0], sz);
      const d = E(ops[1], sz, pc + 2 + s.ext.length * 2);
      const name = mnem.replace(/a$/, "") as "add" | "sub" | "and" | "or" | "cmp" | "eor";
      if (s.kind === "imm" && d.kind !== "an" && name !== "eor") {
        return encode(name + "i", sfx, ops, pc, labels, lenient);
      }
      if (name === "eor") {
        if (s.kind === "imm") return encode("eori", sfx, ops, pc, labels, lenient);
        if (s.kind !== "dn") throw new AsmError("eor source must be a data register");
        return words(0xb100 | (s.reg << 9) | (SZ2[sz] << 6) | eaBits(d), ...d.ext);
      }
      const baseOp = { add: 0xd000, sub: 0x9000, and: 0xc000, or: 0x8000, cmp: 0xb000 }[name];
      if (d.kind === "an") {
        if (name === "and" || name === "or") throw new AsmError(`${name} to address register not allowed`);
        if (sz === 0) throw new AsmError("byte size not allowed with address register");
        return words(baseOp | (d.reg << 9) | (sz === 2 ? 0x1c0 : 0xc0) | eaBits(s), ...s.ext);
      }
      if (d.kind === "dn") return words(baseOp | (d.reg << 9) | (SZ2[sz] << 6) | eaBits(s), ...s.ext);
      if (s.kind === "dn" && name !== "cmp") return words(baseOp | (s.reg << 9) | 0x100 | (SZ2[sz] << 6) | eaBits(d), ...d.ext);
      throw new AsmError(`unsupported operands for ${mnem}`);
    }
    case "cmpm": {
      const sz = sizeOf(sfx);
      const a = parseInt(ops[0].replace(/\D/g, ""), 10), b = parseInt(ops[1].replace(/\D/g, ""), 10);
      return words(0xb108 | (b << 9) | (SZ2[sz] << 6) | a);
    }
    case "btst":
    case "bset":
    case "bclr":
    case "bchg": {
      need(2);
      const t = { btst: 0, bchg: 1, bclr: 2, bset: 3 }[mnem];
      if (ops[0].startsWith("#")) {
        const bit = evalExpr(ops[0].slice(1), labels, pc, lenient);
        const d = E(ops[1], 0, pc + 4);
        return words(0x0800 | (t << 6) | eaBits(d), bit & 0xff, ...d.ext);
      }
      const r = regNum(ops[0]);
      if (!r || r.a) throw new AsmError("bit number must be #imm or Dn");
      const d = E(ops[1], 0);
      return words(0x0100 | (r.n << 9) | (t << 6) | eaBits(d), ...d.ext);
    }
    case "movem": {
      need(2);
      const sz = sfx === "l" ? 1 : 0;
      const toMem = !!(regNum(ops[0].split(/[/-]/)[0]) && !regNum(ops[1].split(/[/-]/)[0]));
      if (toMem) {
        let mask = regList(ops[0]);
        const d = E(ops[1], 1, pc + 4);
        if (d.kind === "predec") {
          let r = 0;
          for (let i = 0; i < 16; i++) if (mask & (1 << i)) r |= 1 << (15 - i);
          mask = r;
        }
        return words(0x4880 | (sz << 6) | eaBits(d), mask, ...d.ext);
      }
      const mask = regList(ops[1]);
      const s = E(ops[0], 1, pc + 4);
      return words(0x4c80 | (sz << 6) | eaBits(s), mask, ...s.ext);
    }
    case "lsl":
    case "lsr":
    case "asl":
    case "asr":
    case "rol":
    case "ror":
    case "roxl":
    case "roxr": {
      const type = { as: 0, ls: 1, rox: 2, ro: 3 }[mnem.slice(0, -1) as "as"]!;
      const left = mnem.endsWith("l") ? 0x100 : 0;
      if (ops.length === 1) {
        const e = E(ops[0], 1);
        return words(0xe0c0 | (type << 9) | left | eaBits(e), ...e.ext);
      }
      const sz = sizeOf(sfx);
      const d = regNum(ops[1]);
      if (!d || d.a) throw new AsmError("shift destination must be Dn");
      if (ops[0].startsWith("#")) {
        const n = evalExpr(ops[0].slice(1), labels, pc, lenient);
        if (!lenient && (n < 1 || n > 8)) throw new AsmError("shift count must be 1..8");
        return words(0xe000 | ((n & 7) << 9) | left | (SZ2[sz] << 6) | (type << 3) | d.n);
      }
      const c = regNum(ops[0]);
      if (!c || c.a) throw new AsmError("shift count must be #n or Dn");
      return words(0xe020 | (c.n << 9) | left | (SZ2[sz] << 6) | (type << 3) | d.n);
    }
    case "mulu":
    case "muls":
    case "divu":
    case "divs": {
      need(2);
      const s = E(ops[0], 1);
      const d = regNum(ops[1]);
      if (!d || d.a) throw new AsmError(`${mnem} destination must be Dn`);
      const base = { mulu: 0xc0c0, muls: 0xc1c0, divu: 0x80c0, divs: 0x81c0 }[mnem];
      return words(base | (d.n << 9) | eaBits(s), ...s.ext);
    }
    case "chk": {
      const s = E(ops[0], 1);
      const d = regNum(ops[1])!;
      return words(0x4180 | (d.n << 9) | eaBits(s), ...s.ext);
    }
    case "exg": {
      need(2);
      const a = regNum(ops[0]), b = regNum(ops[1]);
      if (!a || !b) throw new AsmError("exg needs registers");
      if (!a.a && !b.a) return words(0xc140 | (a.n << 9) | b.n);
      if (a.a && b.a) return words(0xc148 | (a.n << 9) | b.n);
      const dr = a.a ? b : a, ar = a.a ? a : b;
      return words(0xc188 | (dr.n << 9) | ar.n);
    }
  }
  throw new AsmError(`unknown instruction "${mnem}"`);
}
