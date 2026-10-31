// Live link bridge, shared by the desktop app and the dev server. The FBNeo script hackrom_live.lua
// writes hackrom_live_state.txt and consumes hackrom_live_cmd.txt in the temp folder.
const fs = require("node:fs");
const path = require("node:path");

// plain commands use a small character set; "lua CODE" carries an injector program (newlines escaped as \n)
const COMMAND = /^[a-z0-9]+( [0-9A-Za-z_.:\\/ -]+)?$/;
const LUA = /^lua [^\x00-\x1f]*$/;

function readState(dir, script) {
  const file = path.join(dir, "hackrom_live_state.txt");
  try {
    const st = fs.statSync(file);
    return { ok: true, ageMs: Date.now() - st.mtimeMs, text: fs.readFileSync(file, "utf8"), dir, script };
  } catch {
    return { ok: false, dir, script };
  }
}

function writeCommands(dir, body) {
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => COMMAND.test(l) || LUA.test(l));
  if (lines.length) fs.appendFileSync(path.join(dir, "hackrom_live_cmd.txt"), lines.join("\n") + "\n");
  return { ok: true, accepted: lines.length };
}

module.exports = { readState, writeCommands };
