// Collects every translatable English string: tr()/t() literals in the source, plus data shown in the UI.
// usage: node .keys.cjs  -> writes src/i18n/keys.json and reports which keys es/pt are missing
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { TUTORIALS } from "../src/tutorials/content";
import { GUIDE_SECTIONS } from "../src/views/docs/content";
import { PROFILES } from "../src/games/profiles";
import { CANCEL_NAMES, COMPARE_MODES, EFFECT_NAMES, LEVEL_NAMES, SELECT_FLAG_NAMES, STUN_NAMES } from "../src/games/kofEngine";
import { ES } from "../src/i18n/es";
import { PT } from "../src/i18n/pt";

const keys = new Set<string>();
const add = (s: string | undefined | null) => {
  if (s && /[A-Za-z]{2}/.test(s)) keys.add(s);
};

// 1) source literals
const ARRAY_VARS = new Set(["NAV", "ROLE_NAMES", "NORMAL_ACTS", "TEMPLATES", "quick", "entries", "INJECTOR_EXAMPLES"]);
function walkDir(d: string): string[] {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walkDir(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
}
for (const file of walkDir("src")) {
  if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node, inArray = false) => {
    if (ts.isCallExpression(node) && ["tr", "t"].includes(node.expression.getText()) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0].text);
    // <Tx s="..."> sentences
    if (ts.isJsxAttribute(node) && node.name.getText() === "s" && node.initializer && ts.isStringLiteral(node.initializer)) add(node.initializer.text);
    if (ts.isVariableDeclaration(node) && ARRAY_VARS.has(node.name.getText())) inArray = true;
    // tuple lists rendered with .map in JSX (cards, sub tabs)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "map") {
      const obj = node.expression.expression;
      const arr = ts.isParenthesizedExpression(obj) ? obj.expression : obj;
      const lit = ts.isAsExpression(arr) ? arr.expression : arr;
      if (ts.isArrayLiteralExpression(lit)) lit.elements.forEach((el) => ts.isArrayLiteralExpression(el) && el.elements.forEach((x) => ts.isStringLiteralLike(x) && /\s/.test(x.text) && add(x.text)));
    }
    if (inArray && ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      const prop = ts.isPropertyAssignment(parent) ? parent.name.getText() : "";
      if (!["tab", "icon", "code", "games"].includes(prop)) add(node.text);
    }
    ts.forEachChild(node, (c) => visit(c, inArray));
  };
  visit(sf);
}

// 2) data shown in the UI
for (const t of TUTORIALS) {
  [t.title, t.section, t.summary, t.time, t.result].forEach(add);
  t.steps.forEach((s) => {
    add(s.text);
    add(s.goLabel);
  });
  t.notes?.forEach(add);
  t.shots?.forEach((s) => add(s.caption));
}
const blockStrings = (b: any): void => {
  if (Array.isArray(b)) return b.forEach(blockStrings);
  for (const [k, v] of Object.entries(b)) {
    if (k === "bytes") (v as any[]).forEach((x) => add(x[1]));
    else if (k === "table") {
      const tb = v as { head?: string[]; rows: string[][]; mono?: number[] };
      tb.head?.forEach(add);
      tb.rows.forEach((r) => r.forEach((c, j) => !tb.mono?.includes(j) && add(c)));
    } else if (k === "legend") (v as any[]).forEach((x) => add(x[1]));
    else if (k === "chain") (v as any[]).forEach((x) => (add(x[0]), add(x[1])));
    else if (k === "fig") add((v as any).caption);
    else if (k === "grid") (v as any[]).forEach(blockStrings);
    else if (typeof v === "string" && k !== "arrow" && k !== "code") add(v);
    else if (Array.isArray(v)) v.forEach((x) => typeof x === "string" && add(x));
  }
};
for (const s of GUIDE_SECTIONS) {
  add(s.title);
  s.blocks.forEach(blockStrings);
}
for (const p of PROFILES) {
  p.notes.forEach(add);
  add(p.mainLoop?.note);
  p.ram.forEach((r) => (add(r.name), add(r.desc)));
  Object.values(p.hitboxTypes ?? {}).forEach((h) => add(h.name));
}
[...EFFECT_NAMES, ...Object.values(LEVEL_NAMES), ...STUN_NAMES, ...Object.values(CANCEL_NAMES), ...Object.values(SELECT_FLAG_NAMES), ...Object.values(COMPARE_MODES)].forEach(add);
["Debug colors", "vulnerability", "attack", "guard", "proj. vulnerability", "proj. attack", "ground", "air", "alt ground", "alt air", "special/super", "command normal", "unknown", "column", "row"].forEach(add);

const list = [...keys].sort();
fs.writeFileSync("src/i18n/keys.json", JSON.stringify(list, null, 1));
const missES = list.filter((k) => !(k in ES)), missPT = list.filter((k) => !(k in PT));
console.log(`${list.length} keys · es missing ${missES.length} · pt missing ${missPT.length}`);
if (process.argv[2] === "--missing") fs.writeFileSync(process.argv[3] ?? "missing.json", JSON.stringify(missES, null, 1));

// translations must keep every {placeholder}, `code` span, **bold** and [link](tab:x) target
const tokens = (s: string) => [...(s.match(/\{\w+\}|`[^`]*`|\(tab:\w+\)/g) ?? []), `**${(s.match(/\*\*/g) ?? []).length}`].sort().join("|");
const bad = list.flatMap((k) => [["es", ES[k]], ["pt", PT[k]]].filter(([, v]) => v && tokens(v) !== tokens(k)).map(([l]) => `${l}: ${k}`));
const extra = Object.keys(ES).filter((k) => !keys.has(k));
if (bad.length) console.log(`markup/placeholder mismatch:\n  ${bad.join("\n  ")}`);
if (extra.length) console.log(`unused translations:\n  ${extra.join("\n  ")}`);
