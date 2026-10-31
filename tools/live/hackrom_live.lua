-- HackROM Studio live link for FBNeo / Fightcade FBNeo.
-- Load it in FBNeo: Game > Lua Scripting > New Lua Script Window > Browse > this file > Run.
-- It talks to the app (npm run dev) through two files in your Windows temp folder (%TEMP%), so nothing
-- is written into your project or a synced folder:
--   hackrom_live_cmd.txt   commands from the app (one per line, consumed every frame)
--   hackrom_live_state.txt game state for the app (rewritten every 3 frames)
-- Everything it changes is temporary: RAM and ROM edits are gone when the game is reset or closed.

local dir = (debug.getinfo(1, "S").source:match("^@(.*[\\/])")) or ""
local tmp = (os.getenv("TEMP") or os.getenv("TMP") or dir):gsub("[\\/]$", "") .. "\\"
local CMD, WORK, STATE, TMP = tmp .. "hackrom_live_cmd.txt", tmp .. "hackrom_live_cmd.work", tmp .. "hackrom_live_state.txt", tmp .. "hackrom_live_state.tmp"

local rb, rw, rd = memory.readbyte, memory.readword, memory.readdword
local wb, ww, wd = memory.writebyte, memory.writeword, memory.writedword

-- move injector (injector.lua next to this file): Lua programs that run one step per frame
local injOk, inj = pcall(dofile, dir .. "injector.lua")
if not injOk then inj = nil end

local freezes = {}      -- key -> {size, addr, value}
local watches = {}      -- list of {addr, len}
local pending = {}      -- banked ROM writes waiting for their bank: {bank, addr, bytes, tries}
local dispatches = {}   -- recent move routine dispatches
local overlay = false
local lastErr = ""
local nCmd = 0

local function hexbytes(s)
  local t = {}
  for h in s:gmatch("%x%x") do t[#t + 1] = tonumber(h, 16) end
  return t
end

local function writeBytes(addr, bytes)
  for i, b in ipairs(bytes) do wb(addr + i - 1, b) end
end

-- Record every move routine the game dispatches: the code that jumps to (A4)+$198.
-- KOF97 $101D8, KOF98 $14854, KOF2002 $2ECF0 (found by the same "move.l (a4),($1C6,a4) / movea.l ($198,a4),a0 / jmp (a0)" code).
local rom = tostring(emu.romname())
local DISPATCH = rom:find("^kof98") and 0x14854 or rom:find("^kof2002") and 0x2ECF0 or 0x101D8
local okReg = pcall(function()
  memory.registerexec(DISPATCH, function()
    local a4 = bit.band(memory.getregister("m68000.a4"), 0xFFFFFF)
    table.insert(dispatches, 1, string.format("%d,%06X,%06X,%03X", emu.framecount(), a4, rd(a4 + 0x198), rw(a4 + 0x72)))
    if #dispatches > 12 then table.remove(dispatches) end
  end)
end)

local function exec(line)
  local w = {}
  for x in line:gmatch("%S+") do w[#w + 1] = x end
  local c = w[1]
  local n = function(i) return tonumber(w[i], 16) end
  if c == "w8" then wb(n(2), n(3))
  elseif c == "w16" then ww(n(2), n(3))
  elseif c == "w32" then wd(n(2), n(3))
  elseif c == "wb" then writeBytes(n(2), hexbytes(w[3]))
  elseif c == "wbb" then -- banked ROM write: wbb BANKID ADDR HEX (applied when that bank is mapped)
    table.insert(pending, { bank = n(2), addr = n(3), bytes = hexbytes(w[4]), tries = 0 })
  elseif c == "freeze" then -- freeze SIZE ADDR VALUE (size 1/2/4)
    freezes[w[3]] = { size = tonumber(w[2]), addr = n(3), value = n(4) }
  elseif c == "unfreeze" then freezes[w[2]] = nil
  elseif c == "unfreezeall" then freezes = {}
  elseif c == "watch" then table.insert(watches, { addr = n(2), len = math.min(n(3), 256) })
  elseif c == "clearwatch" then watches = {}
  elseif c == "trigger" then -- trigger OBJ ROUTINE : start a complete move routine on an object (P1 108100, P2 108300)
    wd(n(2) + 0x198, n(3)); wd(n(2), n(3))
  elseif c == "save" or c == "load" then
    local path = line:match("^%S+%s+(.+)$")
    if not path:match("^%a:") and not path:match("^[/\\]") then path = dir .. path end
    local st = savestate.create(path)
    if c == "save" then savestate.save(st) else savestate.load(st) end
  elseif c == "overlay" then overlay = w[2] == "1"
  elseif c == "lua" then -- lua CODE : run a program with the injector; the app escapes "\" as "\\" and newlines as "\n"
    if not inj then error("injector.lua not found next to hackrom_live.lua") end
    local code = line:match("^lua%s(.*)$") or ""
    code = code:gsub("\\(.)", function(ch) if ch == "n" then return "\n" end return ch end)
    inj.run(code, "program")
  elseif c == "luastop" then
    if inj then inj.stopAll() end
  elseif c == "pal" then -- pal INDEX HEXWORDS : write a 16 color palette into palette RAM
    local base = 0x400000 + n(2) * 32
    writeBytes(base, hexbytes(w[3]))
  end
end

local function readCommands()
  local f = io.open(CMD, "r")
  if not f then return end
  f:close()
  os.remove(WORK)
  if not os.rename(CMD, WORK) then return end
  local g = io.open(WORK, "r")
  if not g then return end
  for line in g:lines() do
    if line:match("%S") then
      local ok, err = pcall(exec, line)
      nCmd = nCmd + 1
      if not ok then lastErr = tostring(err) end
    end
  end
  g:close()
  os.remove(WORK)
end

local function applyPending()
  local bank = rw(0x200000)
  for i = #pending, 1, -1 do
    local p = pending[i]
    if p.bank == bank then
      writeBytes(p.addr, p.bytes)
      table.remove(pending, i)
    else
      p.tries = p.tries + 1
      if p.tries > 600 then lastErr = string.format("bank %04X never mapped for %06X", p.bank, p.addr); table.remove(pending, i) end
    end
  end
end

local function applyFreezes()
  for _, f in pairs(freezes) do
    if f.size == 1 then wb(f.addr, f.value) elseif f.size == 2 then ww(f.addr, f.value) else wd(f.addr, f.value) end
  end
end

local function hexrange(a, len)
  local t = {}
  for i = 0, len - 1 do t[#t + 1] = string.format("%02X", rb(a + i)) end
  return table.concat(t)
end

local function player(base)
  -- ch act routine next x y hp power facing status graph frameidx boxes(5x5 bytes) p2act-input-buttons
  return string.format("%02X,%03X,%06X,%06X,%d,%d,%02X,%02X,%02X,%02X,%06X,%d,%s",
    rw(base + 0x70), rw(base + 0x72), rd(base + 0x198), rd(base), memory.readwordsigned(base + 0x18), memory.readwordsigned(base + 0x26),
    rb(base + 0x139), rb(base + 0x1E3), rb(base + 0x31), rb(base + 0x7C), bit.band(rd(base + 0x28), 0xFFFFFF), rw(base + 0x80), hexrange(base + 0x90, 25))
end

local function writeState()
  local lines = {
    "frame=" .. emu.framecount(),
    "rom=" .. tostring(emu.romname()),
    "bank=" .. string.format("%04X", rw(0x200000)),
    "timer=" .. string.format("%02X", rb(0x10A83A)),
    "p1=" .. player(0x108100),
    "p2=" .. player(0x108300),
    "dispatch=" .. table.concat(dispatches, ";"),
    "cmds=" .. nCmd,
    "pending=" .. #pending,
    "err=" .. lastErr,
    "dispatchHook=" .. (okReg and 1 or 0),
    "lua=" .. (inj and inj.running() or -1),
    "luaout=" .. (inj and table.concat(inj.output(), "\t") or ""),
  }
  local fz = {}
  for k, f in pairs(freezes) do fz[#fz + 1] = string.format("%d:%06X:%X", f.size, f.addr, f.value) end
  lines[#lines + 1] = "freezes=" .. table.concat(fz, ";")
  for _, wch in ipairs(watches) do lines[#lines + 1] = string.format("w%06X=%s", wch.addr, hexrange(wch.addr, wch.len)) end
  local f = io.open(TMP, "w")
  if not f then return end
  f:write(table.concat(lines, "\n"), "\n")
  f:close()
  os.remove(STATE)
  os.rename(TMP, STATE)
end

local function rbs(a) local v = rb(a); if v >= 0x80 then v = v - 0x100 end; return v end
local function drawOverlay()
  gui.clearuncommitted()
  local left = memory.readwordsigned(0x10B092 + 0x38)
  for _, base in ipairs({ 0x108100, 0x108300 }) do
    local px = memory.readwordsigned(base + 0x18) - left
    local py = memory.readwordsigned(base + 0x26) - 16
    local flip = (bit.band(rb(base + 0x31), 1) ~= 0) and -1 or 1
    local status = rb(base + 0x7C)
    for slot, off in ipairs({ 0x90, 0x95, 0x9A, 0x9F }) do
      local a = base + off
      local id, rx, ry = rb(a), rb(a + 3), rb(a + 4)
      if bit.band(status, bit.lshift(1, slot - 1)) ~= 0 and (rx > 0 or ry > 0) then
        local cx, cy = px + rbs(a + 1) * flip, py + rbs(a + 2)
        local col = 0x7777FF -- training mode colors: vulnerability / guard / attack / projectile vulnerability
        if id >= 10 and id <= 11 then col = 0xCCCCFF elseif id >= 12 and id <= 55 then col = 0xFF0000 elseif id >= 56 and id <= 57 then col = 0xCCCCFF elseif id >= 58 then col = 0x00FFFF end
        gui.box(cx - rx, cy - ry, cx + rx - 1, cy + ry - 1, col * 256 + 0x40, col * 256 + 0xFF)
      end
    end
    gui.line(px - 6, py, px + 6, py, 0xFFFFFFFF); gui.line(px, py - 6, px, py + 6, 0xFFFFFFFF)
  end
end

emu.registerafter(function()
  readCommands()
  applyPending()
  applyFreezes()
  if overlay then drawOverlay() end
  if emu.framecount() % 3 == 0 then writeState() end
end)

print("HackROM Studio live link running. State file: " .. STATE)
while true do
  -- injector programs press their inputs before the frame runs
  if inj then local ok, err = pcall(inj.step); if not ok then lastErr = tostring(err) end end
  emu.frameadvance()
end
