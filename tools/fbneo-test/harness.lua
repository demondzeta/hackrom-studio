-- Test harness: load the savestate, play scripted inputs, log RAM and take screenshots.
-- Config comes from harness_cfg.lua (written by the test runner).
local gd = require("gd")
local cfg = dofile("harness_cfg.lua")
local log = io.open(cfg.out .. "_log.txt", "w")
local function L(s) log:write(s .. "\n"); log:flush() end
for i = 1, 30 do emu.frameadvance() end
L("booted")
local st = savestate.create(cfg.state)
savestate.load(st)
L("loaded " .. cfg.state)
emu.frameadvance()
L("advanced after load")
local function rw(a) return memory.readword(a) end
local function rws(a) local v = memory.readword(a); if v >= 0x8000 then v = v - 0x10000 end; return v end
local function rbs(a) local v = memory.readbyte(a); if v >= 0x80 then v = v - 0x100 end; return v end
-- hit/hurt box overlay (same RAM layout as Fightcade's kof-hitboxes.lua)
local function drawBoxes()
  gui.clearuncommitted()
  local left = rws(0x10B092 + 0x38)
  for _, base in ipairs({0x108100, 0x108300}) do
    local px = rws(base + 0x18) - left
    local py = rws(base + 0x26) - 16
    local flip = (bit.band(memory.readbyte(base + 0x31), 1) ~= 0) and -1 or 1
    local status = memory.readbyte(base + 0x7C)
    for slot, off in ipairs({0x90, 0x95, 0x9A, 0x9F}) do
      local a = base + off
      local id = memory.readbyte(a)
      local rx, ry = memory.readbyte(a + 3), memory.readbyte(a + 4)
      if bit.band(status, bit.lshift(1, slot - 1)) ~= 0 and (rx > 0 or ry > 0) then
        local cx, cy = px + rbs(a + 1) * flip, py + rbs(a + 2)
        local col = id >= 0x0C and 0xFF000060 or (id >= 0x0A and 0xCCCCFF60 or 0x7777FF60)
        local edge = id >= 0x0C and 0xFF0000FF or (id >= 0x0A and 0xCCCCFFFF or 0x7777FFFF)
        gui.box(cx - rx, cy - ry, cx + rx - 1, cy + ry - 1, col, edge)
      end
    end
    gui.line(px - 6, py, px + 6, py, 0xFFFFFFFF); gui.line(px, py - 6, px, py + 6, 0xFFFFFFFF)
  end
end
for f = 1, cfg.frames do
  local okI, inp = pcall(function() return cfg.inputs and cfg.inputs(f) end); if not okI then L("input error: " .. tostring(inp)); inp = nil end
  if inp then joypad.set(inp) end
  if cfg.poke then local ok, err = pcall(cfg.poke, f, memory); if not ok then L("poke error f" .. f .. ": " .. tostring(err)) end end
  if cfg.logEvery and f % cfg.logEvery == 0 then
    L(string.format("f%d P1 ch=%02X act=%03X hp=%02X  P2 ch=%02X act=%03X hp=%02X timer=%02X", f,
      rw(0x108170), rw(0x108172), memory.readbyte(0x108239), rw(0x108370), rw(0x108372), memory.readbyte(0x108439), memory.readbyte(0x10A83A)))
  end
  if cfg.boxes then drawBoxes() end
  for _, s in ipairs(cfg.shots) do
    if s == f then local ok, err = pcall(function() gd.createFromGdStr(gui.gdscreenshot()):png(cfg.out .. "_f" .. f .. ".png") end); L("shot " .. f .. (ok and "" or (" FAILED: " .. tostring(err)))) end
  end
  emu.frameadvance()
end
L("done")
log:close()


