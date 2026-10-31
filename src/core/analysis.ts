// Program analysis: Neo Geo header, vectors, main loop candidates, free space, search, hooks.
import { hex6 } from "./bytes";
import { assemble } from "./m68k/asm";
import { disasm, Insn, traceCode } from "./m68k/disasm";
import type { RomSet } from "./romset";
import { tr } from "../i18n";

export interface HeaderInfo {
  valid: boolean;
  ngh: number;
  programSize: number;
  backupRam: number;
  backupSize: number;
  eyeCatcher: number;
  entries: { name: string; addr: number; target: number | null; note: string }[];
  vectors: { name: string; vector: number; target: number }[];
}

const jmpTarget = (rs: RomSet, a: number) => {
  const op = rs.read16(a);
  if (op === 0x4ef9) return rs.read32(a + 2) & 0xffffff;
  if (op === 0x6000) return (a + 2 + ((rs.read16(a + 2) << 16) >> 16)) & 0xffffff;
  return null;
};

export function readHeader(rs: RomSet): HeaderInfo {
  const sig = String.fromCharCode(...rs.readBytes(0x100, 7));
  const entries = [
    { name: "USER", addr: 0x122, note: "Called by the BIOS every frame with a BIOS_USER_REQUEST command. The game's main code starts here." },
    { name: "PLAYER_START", addr: 0x128, note: "Called when a player presses START with credits." },
    { name: "DEMO_END", addr: 0x12e, note: "Called when the attract/demo sequence must stop." },
    { name: "COIN_SOUND", addr: 0x134, note: "Called when a coin is inserted." },
  ].map((e) => ({ ...e, target: jmpTarget(rs, e.addr) }));
  const vecNames: [string, number][] = [
    ["Initial SSP", 0x00],
    ["Reset PC", 0x04],
    ["Bus error", 0x08],
    ["Address error", 0x0c],
    ["Illegal instruction", 0x10],
    ["Trace", 0x24],
    ["Line A", 0x28],
    ["Line F", 0x2c],
    ["IRQ1 VBlank", 0x64],
    ["IRQ2 Timer (raster)", 0x68],
    ["IRQ3", 0x6c],
  ];
  return {
    valid: sig === "NEO-GEO",
    ngh: rs.read16(0x108),
    programSize: rs.read32(0x10a),
    backupRam: rs.read32(0x10e),
    backupSize: rs.read16(0x112),
    eyeCatcher: rs.read8(0x114),
    entries,
    vectors: vecNames.map(([name, v]) => ({ name, vector: v, target: rs.read32(v) & 0xffffff })),
  };
}

export interface LoopCandidate {
  start: number;
  end: number; // address of the backward branch
  calls: number[];
  score: number;
  reasons: string[];
}

/** Heuristic main loop finder: backward branches whose body calls many subroutines and waits for VBlank. */
export function findMainLoops(rs: RomSet, extraEntries: number[] = []): { loops: LoopCandidate[]; code: Map<number, Insn> } {
  const h = readHeader(rs);
  const entries = [...h.entries.map((e) => e.target).filter((x): x is number => x !== null && x < 0x100000), ...extraEntries];
  const vbl = h.vectors.find((v) => v.vector === 0x64)?.target;
  if (vbl && vbl < 0x100000) entries.push(vbl);
  const code = traceCode(rs.reader(0), entries, 60000);
  const loops: LoopCandidate[] = [];
  for (const ins of code.values()) {
    if ((ins.kind !== "branch" && ins.kind !== "cond") || ins.target === undefined) continue;
    if (ins.target >= ins.addr || ins.addr - ins.target > 0x800) continue;
    const calls: number[] = [];
    const reasons: string[] = [];
    let waits = false, watchdog = false;
    let a = ins.target;
    while (a <= ins.addr) {
      const i = code.get(a) ?? disasm(rs.reader(0), a);
      if (i.kind === "call" && i.target !== undefined) calls.push(i.target);
      if (/^(tst|cmp|btst)/.test(i.mnemonic) && i.refs.some((r) => r >= 0x100000 && r < 0x110000)) waits = true;
      if (i.refs.includes(0x300001)) watchdog = true;
      a += i.size;
      if (i.size <= 0) break;
    }
    if (calls.length < 2) continue;
    let score = calls.length * 2;
    reasons.push(tr("{n} subroutine calls", { n: calls.length }));
    if (waits) {
      score += 4;
      reasons.push(tr("tests a work RAM flag (likely VBlank wait)"));
    }
    if (watchdog) {
      score += 3;
      reasons.push(tr("kicks the watchdog ($300001)"));
    }
    if (ins.kind === "branch") {
      score += 2;
      reasons.push(tr("unconditional loop"));
    }
    loops.push({ start: ins.target, end: ins.addr, calls, score, reasons });
  }
  loops.sort((a, b) => b.score - a.score);
  return { loops: loops.slice(0, 15), code };
}

/** Runs of FF or 00 bytes that can be used for new code/data. */
export function findFreeSpace(data: Uint8Array, minLen = 64, from = 0, to = data.length): { offset: number; length: number; fill: number }[] {
  const out: { offset: number; length: number; fill: number }[] = [];
  let i = from;
  while (i < to) {
    const v = data[i];
    if (v !== 0xff && v !== 0x00) {
      i++;
      continue;
    }
    let j = i;
    while (j < to && data[j] === v) j++;
    // keep a small guard so we never overwrite the tail of real data
    const start = (i + 0x10 + 1) & ~1;
    const len = j - start;
    if (len >= minLen) out.push({ offset: start, length: len, fill: v });
    i = j;
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Pattern search. Pattern is hex with ?? wildcards, e.g. "4EB9 ???? ????". Returns file offsets. */
export function searchPattern(data: Uint8Array, pattern: string, step = 1, limit = 500): number[] {
  const clean = pattern.replace(/\s+/g, "");
  if (!clean || clean.length % 2) return [];
  const pat: (number | null)[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const t = clean.substr(i, 2);
    pat.push(t === "??" ? null : parseInt(t, 16));
  }
  const out: number[] = [];
  const first = pat[0];
  outer: for (let i = 0; i + pat.length <= data.length; i += step) {
    if (first !== null && data[i] !== first) continue;
    for (let k = 1; k < pat.length; k++) if (pat[k] !== null && data[i + k] !== pat[k]) continue outer;
    out.push(i);
    if (out.length >= limit) break;
  }
  return out;
}

/** Find instructions in a code map that reference or branch to `addr`. */
export function xrefsTo(code: Map<number, Insn>, addr: number): Insn[] {
  const out: Insn[] = [];
  for (const i of code.values()) if (i.target === addr || i.refs.includes(addr)) out.push(i);
  return out.sort((a, b) => a.addr - b.addr);
}

// ---------------- hooks / detours ----------------

export interface HookPlan {
  ok: boolean;
  errors: string[];
  warnings: string[];
  site: number;
  displaced: Insn[];
  displacedBytes: number;
  sitePatch: Uint8Array;
  hookAddr: number;
  hookCode: Uint8Array;
  listing: string;
}

/**
 * Build a detour: the instructions at `site` are replaced by `JMP hookAddr.l` (+NOPs);
 * the hook runs the user's code, then the displaced instructions, then jumps back.
 */
export function planHook(
  rs: RomSet,
  site: number,
  hookAddr: number,
  userAsm: string,
  saveRegs: boolean,
  labels: Record<string, number> = {},
  code?: Map<number, Insn>,
): HookPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (code && code.size) {
    if (!code.has(site)) {
      let inside: Insn | undefined;
      for (let a = site - 2; a >= site - 10 && !inside; a -= 2) {
        const i = code.get(a);
        if (i && a + i.size > site) inside = i;
      }
      if (inside) errors.push(tr("{site} is in the middle of \"{ins}\" at {addr} — hook at {addr} instead", { site: hex6(site), ins: inside.text, addr: hex6(inside.addr) }));
      else warnings.push(tr("{site} was not reached by the code tracer; make sure it is an instruction start", { site: hex6(site) }));
    }
  }
  const rd = rs.reader(0);
  const displaced: Insn[] = [];
  let len = 0;
  while (len < 6) {
    const ins = disasm(rd, site + len);
    displaced.push(ins);
    len += ins.size;
    if (ins.kind === "invalid") errors.push(tr("invalid instruction at {addr} — pick an instruction boundary", { addr: hex6(ins.addr) }));
    if (ins.pcRelative) errors.push(tr("{addr} \"{ins}\" is PC-relative and cannot be moved; choose a different hook site", { addr: hex6(ins.addr), ins: ins.text }));
    if (ins.kind === "ret" || ins.kind === "branch" || ins.kind === "jump")
      if (len < 6) errors.push(tr("{addr} \"{ins}\" ends the block before 6 bytes; choose a site with longer straight code", { addr: hex6(ins.addr), ins: ins.text }));
    if (ins.kind === "cond") errors.push(tr("{addr} conditional branch cannot be relocated", { addr: hex6(ins.addr) }));
  }
  if (site & 1 || hookAddr & 1) errors.push(tr("addresses must be even"));
  const back = site + len;
  const pre = saveRegs ? "  movem.l d0-d7/a0-a6,-(sp)\n" : "";
  const post = saveRegs ? "  movem.l (sp)+,d0-d7/a0-a6\n" : "";
  const src = `${pre}${userAsm}\n${post}`;
  const res = assemble(src, hookAddr, labels);
  res.errors.forEach((e) => errors.push(tr("asm line {n}: {msg}", { n: e.line - (saveRegs ? 1 : 0), msg: e.message })));
  const disp = rs.readBytes(site, len);
  const jmpBack = [0x4e, 0xf9, (back >>> 24) & 0xff, (back >>> 16) & 0xff, (back >>> 8) & 0xff, back & 0xff];
  const hookCode = Uint8Array.from([...res.bytes, ...disp, ...jmpBack]);
  const sitePatch = new Uint8Array(len);
  sitePatch.set([0x4e, 0xf9, (hookAddr >>> 24) & 0xff, (hookAddr >>> 16) & 0xff, (hookAddr >>> 8) & 0xff, hookAddr & 0xff]);
  for (let i = 6; i + 1 < len; i += 2) {
    sitePatch[i] = 0x4e;
    sitePatch[i + 1] = 0x71;
  }
  if (hookAddr >= 0x200000) warnings.push(tr("Hook code in the banked area only runs correctly while that bank is selected. Prefer free space in P1 (< $100000)."));
  // ensure target region is free
  const loc = rs.cpuToFile(hookAddr, 0);
  if (!loc) errors.push(tr("hook address is not inside a ROM file"));
  else {
    const d = rs.files[loc.file].data;
    for (let i = 0; i < hookCode.length; i++) {
      const b = d[loc.offset + i];
      if (b !== 0xff && b !== 0x00) {
        warnings.push(tr("hook area {from}..{to} is not empty (byte {b} at +{i}). Make sure it is unused.", { from: hex6(hookAddr), to: hex6(hookAddr + hookCode.length), b: b.toString(16), i }));
        break;
      }
    }
  }
  const listing = [
    `; site ${hex6(site)}: jmp ${hex6(hookAddr)}  (${len} bytes replaced)`,
    ...displaced.map((d) => `;   moved: ${hex6(d.addr)}  ${d.text}`),
    `; hook ${hex6(hookAddr)} .. ${hex6(hookAddr + hookCode.length)}`,
    ...res.listing.map((l) => `${hex6(l.addr)}  ${l.src.trim()}`),
    ...displaced.map((d) => `        ${d.text}    ; displaced`),
    `        jmp      ${hex6(back)}.l    ; return`,
  ].join("\n");
  return { ok: errors.length === 0, errors, warnings, site, displaced, displacedBytes: len, sitePatch, hookAddr, hookCode, listing };
}

export function applyHook(rs: RomSet, plan: HookPlan) {
  rs.batch(`hook at ${hex6(plan.site)}`, () => {
    rs.writeCpu(plan.hookAddr, plan.hookCode, 0, "hook code");
    rs.writeCpu(plan.site, plan.sitePatch, 0, "hook site");
  });
}

/** Scan code for `move.l #imm,(d16,An)` writes (opcode 0x217C..0x2F7C) — used to find routine pointer assignments. */
export function findMoveLImmToDisp(data: Uint8Array, disp: number, baseAddr = 0, areg = -1): { addr: number; value: number; reg: number }[] {
  const out: { addr: number; value: number; reg: number }[] = [];
  for (let i = 0; i + 8 <= data.length; i += 2) {
    const op = (data[i] << 8) | data[i + 1];
    if ((op & 0xf1ff) !== 0x217c) continue;
    const reg = (op >> 9) & 7;
    if (areg >= 0 && reg !== areg) continue;
    const d = (data[i + 6] << 8) | data[i + 7];
    if (d !== disp) continue;
    const value = ((data[i + 2] << 24) | (data[i + 3] << 16) | (data[i + 4] << 8) | data[i + 5]) >>> 0;
    out.push({ addr: baseAddr + i, value, reg });
  }
  return out;
}
