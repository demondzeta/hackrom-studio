// Turn a routine in ROM into relocatable assembly source (for cloning / modifying moves).
import { hex6 } from "./bytes";
import { disasm, Insn, Reader } from "./m68k/disasm";

export interface RoutineSource {
  source: string;
  start: number;
  end: number;
  entries: number[];
  warnings: string[];
  insns: Insn[];
}

const label = (a: number) => `L_${hex6(a)}`;

/**
 * Trace a routine from `start`, following branches and code pointers stored with
 * `move.l #imm,...` (KOF continues moves on the next frame through such pointers),
 * as long as they stay inside [start - window, start + window].
 */
export function routineToAsm(rd: Reader, start: number, window = 0x1200): RoutineSource {
  const lo = Math.max(0, start - window), hi = start + window;
  const inRange = (a: number) => a >= lo && a < hi && !(a & 1);
  const seen = new Map<number, Insn>();
  const work = [start];
  const entries = new Set<number>([start]);
  const warnings: string[] = [];
  while (work.length && seen.size < 3000) {
    let a = work.pop()!;
    while (inRange(a) && !seen.has(a)) {
      const ins = disasm(rd, a);
      seen.set(a, ins);
      if (ins.kind === "invalid") {
        warnings.push(`invalid opcode at ${hex6(a)} — tracing stopped there`);
        break;
      }
      if (ins.target !== undefined && inRange(ins.target) && ins.kind !== "call") work.push(ins.target);
      if (ins.target !== undefined && ins.kind === "call" && ins.mnemonic.startsWith("bsr") && inRange(ins.target)) work.push(ins.target);
      // code pointers: move.l #imm,(An) / move.l #imm,(d16,An)
      const m = ins.mnemonic === "move.l" ? ins.operands.match(/^#\$([0-9A-F]+),/) : null;
      if (m) {
        const v = parseInt(m[1], 16);
        if (inRange(v)) {
          entries.add(v);
          work.push(v);
        }
      }
      if (ins.kind === "ret" || ins.kind === "branch" || ins.kind === "jump") break;
      a += ins.size;
    }
  }
  const insns = [...seen.values()].sort((a, b) => a.addr - b.addr);
  const targets = new Set<number>(entries);
  for (const i of insns) if (i.target !== undefined && seen.has(i.target)) targets.add(i.target);
  const lines: string[] = [`; cloned from ${hex6(start)} — edit freely, then assemble at a free address`, ``];
  let prevEnd = -1;
  for (const i of insns) {
    if (prevEnd >= 0 && i.addr !== prevEnd) lines.push(`; --- gap ${hex6(prevEnd)}..${hex6(i.addr)} (not part of this routine) ---`);
    if (targets.has(i.addr)) lines.push(`${label(i.addr)}:${i.addr === start ? "    ; entry" : entries.has(i.addr) ? "    ; continuation (stored as code pointer)" : ""}`);
    let ops = i.operands;
    // relative branches -> labels
    if (i.target !== undefined && seen.has(i.target) && (i.kind === "branch" || i.kind === "cond" || i.mnemonic.startsWith("bsr") || i.mnemonic.startsWith("db"))) {
      ops = ops.replace(/\$[0-9A-F]+$/, label(i.target));
    }
    // pc relative operand -> absolute (or label)
    ops = ops.replace(/\(\$([0-9A-F]+),pc\)/g, (_, h) => {
      const t = parseInt(h, 16);
      return seen.has(t) ? `(${label(t)},pc)` : `($${h}).l`;
    });
    if (/,pc,/.test(ops)) warnings.push(`${hex6(i.addr)} uses a PC-indexed table — copy that table too or rewrite it`);
    // code-pointer immediates -> labels
    ops = ops.replace(/#\$([0-9A-F]+)/g, (s, h) => {
      const v = parseInt(h, 16);
      return entries.has(v) && i.mnemonic === "move.l" ? `#${label(v)}` : s;
    });
    // short branches can overflow after edits; force word size
    let mn = i.mnemonic.replace(/^(b(?:ra|sr|hi|ls|cc|cs|ne|eq|vc|vs|pl|mi|ge|lt|gt|le))\.s$/, "$1.w");
    if (i.kind === "invalid") mn = "dc.w";
    lines.push(`    ${mn.padEnd(9)}${ops}`);
    prevEnd = i.addr + i.size;
  }
  const end = insns.length ? insns[insns.length - 1].addr + insns[insns.length - 1].size : start;
  return { source: lines.join("\n"), start, end, entries: [...entries], warnings, insns };
}
