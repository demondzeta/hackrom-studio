// Writes docs/TUTORIALS.md (English) plus TUTORIALS.es.md / TUTORIALS.pt.md from the in-app tutorial content.
import { writeFileSync } from "node:fs";
import { setLangGlobal, type Lang } from "../src/i18n";
import { toMarkdown, TUTORIALS } from "../src/tutorials/content";
for (const [lang, file] of [["en", "docs/TUTORIALS.md"], ["es", "docs/TUTORIALS.es.md"], ["pt", "docs/TUTORIALS.pt.md"]] as [Lang, string][]) {
  setLangGlobal(lang);
  writeFileSync(file, toMarkdown(TUTORIALS, "../public/"));
  console.log(`${file} written`);
}
