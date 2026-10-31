// One-off codemod: wrap JSX text and user-facing string attributes in tr("...").
// usage: node scripts/i18nwrap.cjs file.tsx ...
const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const ATTRS = new Set(["title", "placeholder", "alt", "label", "aria-label", "summary", "desc", "hint"]);
const hasWords = (s) => /[A-Za-z]{2}/.test(s);

function cleanJsxText(raw) {
  // Babel's whitespace rules for JSX text
  const lines = raw.split(/\r?\n/);
  const out = [];
  lines.forEach((line, i) => {
    let l = line.replace(/\t/g, " ");
    if (i !== 0) l = l.replace(/^ +/, "");
    if (i !== lines.length - 1) l = l.replace(/ +$/, "");
    if (l) out.push(l);
  });
  return out.join(" ");
}

for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const raw = node.getFullText();
      const text = cleanJsxText(raw);
      if (hasWords(text) && !/[{}<>]/.test(text)) {
        const core = text.trim();
        const lead = /^\s/.test(text) ? '{" "}' : "";
        const trail = /\s$/.test(text) ? '{" "}' : "";
        edits.push({ start: node.getFullStart(), end: node.getEnd(), text: `${lead}{tr(${JSON.stringify(core)})}${trail}` });
      }
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const v = node.initializer.text;
      if (ATTRS.has(name) && hasWords(v)) edits.push({ start: node.initializer.getStart(), end: node.initializer.getEnd(), text: `{tr(${JSON.stringify(v)})}` });
    } else if (ts.isCallExpression(node) && node.expression.getText() === "toast" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const a = node.arguments[0];
      if (hasWords(a.text)) edits.push({ start: a.getStart(), end: a.getEnd(), text: `tr(${JSON.stringify(a.text)})` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!edits.length) {
    console.log(path.basename(file), "no changes");
    continue;
  }
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // add import
  const rel = path.relative(path.dirname(file), path.join(__dirname, "..", "src", "i18n")).replace(/\\/g, "/");
  const imp = `import { tr } from "${rel.startsWith(".") ? rel : "./" + rel}";\n`;
  if (!/import \{[^}]*\btr\b[^}]*\} from "[^"]*i18n"/.test(out)) {
    const lastImport = [...out.matchAll(/^import .*;$/gm)].pop();
    const at = lastImport ? lastImport.index + lastImport[0].length + 1 : 0;
    out = out.slice(0, at) + imp + out.slice(at);
  }
  fs.writeFileSync(file, out);
  console.log(path.basename(file), edits.length, "strings wrapped");
}
