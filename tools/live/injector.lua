-- HackROM Studio move injector for FBNeo (KOF96-2002 engine).
--
-- Runs small Lua "programs" inside the emulator, one step per frame, so you can make P1 or P2 do
-- anything: start any complete move, press any motion, wait for a state, change HP/power/position.
--
-- Use it three ways:
--   1. From the app: Live tab > Lua injector (the live link loads this file and runs what you send).
--   2. From your own FBNeo script:  local inj = dofile("injector.lua"); inj.run([[ ...code... ]])
--      and call inj.step() once per frame before emu.frameadvance().
--   3. inject_demo.lua in this folder: a ready-made test that loads a savestate and runs a demo.
--
-- How it works (KOF97, checked in FBNeo; KOF98/2002 use the same object layout):
--   Every object (player, projectile, effect) is a RAM block. Its first long, +0, is a code pointer:
--   the object's current STATE. Each frame the main loop walks the object list and does
--   "movea.l (a4),a0 / jsr (a0)", so whatever routine +0 points to runs once per frame. A state
--   changes by writing a new address into +0 ("move.l #next,(a4)").
--   Neutral (standing) state polls the command handler; a recognised move stores its routine in +$198
--   and jumps through the dispatcher, which saves +0 into +$1C6 and jumps to +$198. The move routine
--   then walks its own phases by rewriting +0 and finally jumps back to neutral.
--   So writing a routine address into BOTH +$198 and +0 starts that move on the next frame, exactly as
--   if the player had entered it. Supers check power, specials don't.

local M = {}

local rb, rw, rd = memory.readbyte, memory.readword, memory.readdword
local wb, ww, wd = memory.writebyte, memory.writeword, memory.writedword

-- player objects and field offsets
local P1, P2 = 0x108100, 0x108300
local F = {
  state = 0x00,     -- long: current state routine (run every frame)
  x = 0x18, y = 0x26, -- words (signed): position in the stage / height
  facing = 0x31,    -- bit 0
  char = 0x70,      -- word: character id
  act = 0x72,       -- word: animation (ACT) playing
  animFlags = 0x7C, -- byte: bit 7 = animation finished, bits 0-3 = active box slots
  frame = 0x80,     -- word: frame index inside the ACT
  air = 0xE0,       -- byte: bit 1 = in the air
  hp = 0x139,       -- byte ($66/$67 = full)
  charBlock = 0x194,-- long: per-character block (+8 = command handler)
  routine = 0x198,  -- long: move routine chosen by the command handler
  saved = 0x1C6,    -- long: state saved by the dispatcher before the move
  power = 0x1E3,    -- byte: power stocks
}
M.P1, M.P2, M.F = P1, P2, F

local out = {}          -- log lines for the app
local tasks = {}        -- running programs: {co, name}
local pad = {}          -- inputs requested for the next frame

local function log(...)
  local t = {}
  for i = 1, select("#", ...) do t[#t + 1] = tostring((select(i, ...))) end
  out[#out + 1] = string.format("f%d %s", emu.framecount(), table.concat(t, " "))
  if #out > 40 then table.remove(out, 1) end
end
M.log = log
function M.output() return out end
function M.clearOutput() out = {} end

-- ---------- reading / writing an object ----------
local function s16(v) if v >= 0x8000 then return v - 0x10000 end return v end
local function info(o)
  return {
    state = rd(o), routine = rd(o + F.routine), saved = rd(o + F.saved), char = rw(o + F.char), act = rw(o + F.act),
    frame = rw(o + F.frame), animDone = bit.band(rb(o + F.animFlags), 0x80) ~= 0, x = s16(rw(o + F.x)), y = s16(rw(o + F.y)),
    air = bit.band(rb(o + F.air), 2) ~= 0, hp = rb(o + F.hp), power = rb(o + F.power),
  }
end
M.info = info
local function other(o) if o == P1 then return P2 end return P1 end
local function playerName(o) if o == P1 then return "P1" end return "P2" end

-- ---------- actions ----------
-- Start a complete move routine now (what the command handler + dispatcher do after a motion).
function M.move(o, routine)
  wd(o + F.routine, routine)
  wd(o + F.saved, rd(o))
  wd(o, routine)
end
function M.setHp(o, v) wb(o + F.hp, v) end
function M.setPower(o, v) wb(o + F.power, v) end
function M.setX(o, v) ww(o + F.x, v % 0x10000) end

-- Facing: +1 when the opponent is to the right (forward = Right), -1 otherwise.
function M.facing(o)
  if s16(rw(o + F.x)) <= s16(rw(other(o) + F.x)) then return 1 end
  return -1
end

-- Hold inputs for this frame. spec: numpad digits (relative to facing) and/or buttons ABCD.
-- 1 2 3 = down-back, down, down-forward; 4 6 = back, forward; 7 8 9 = up-back, up, up-forward.
local DIRS = { ["1"] = { "d", "b" }, ["2"] = { "d" }, ["3"] = { "d", "f" }, ["4"] = { "b" }, ["6"] = { "f" }, ["7"] = { "u", "b" }, ["8"] = { "u" }, ["9"] = { "u", "f" } }
function M.hold(o, spec)
  local p = playerName(o)
  local fwd, back = "Right", "Left"
  if M.facing(o) < 0 then fwd, back = "Left", "Right" end
  for ch in spec:upper():gmatch(".") do
    if DIRS[ch] then
      for _, d in ipairs(DIRS[ch]) do
        local key = (d == "d" and "Down") or (d == "u" and "Up") or (d == "f" and fwd) or back
        pad[p .. " " .. key] = true
      end
    elseif ch:match("[ABCD]") then
      pad[p .. " Button " .. ch] = true
    end
  end
end
M.P = playerName

-- ---------- program helpers (only inside M.run code: they wait by yielding) ----------
local function wait(n)
  for _ = 1, (n or 1) do coroutine.yield() end
end
M.wait = wait

-- Press a motion: "236C" = down, down-forward, forward + C. Each step held `step` frames (default 3);
-- the buttons in the last group are pressed together with the last direction.
-- Long motions (supers, 236236) need step 4, or the button as its own step: motion(P, "236236"); motion(P, "A").
-- Checked in KOF97: at 2-3 frames per step the game reads the two forwards as a dash first.
function M.motion(o, notation, step)
  step = step or 3
  local groups = {}
  for d, btn in notation:upper():gmatch("([1-9]?)([ABCD]*)") do
    if d ~= "" or btn ~= "" then groups[#groups + 1] = d .. btn end
  end
  for _, g in ipairs(groups) do
    for _ = 1, step do M.hold(o, g); coroutine.yield() end
  end
end

-- Hold a spec for n frames (e.g. walk forward: press(P2, "6", 30)).
function M.press(o, spec, n)
  for _ = 1, (n or 1) do M.hold(o, spec); coroutine.yield() end
end

-- Wait until the object is back in neutral (ACT 0, not airborne) or `timeout` frames pass.
function M.waitNeutral(o, timeout)
  timeout = timeout or 600
  local ok = 0
  for _ = 1, timeout do
    local i = info(o)
    if i.act == 0 and not i.air then ok = ok + 1 else ok = 0 end
    if ok >= 2 then return true end
    coroutine.yield()
  end
  return false
end

-- Wait until a field condition holds: until(function() return M.info(P2).act == 0x102 end, 120)
function M.waitUntil(fn, timeout)
  for _ = 1, (timeout or 600) do
    if fn() then return true end
    coroutine.yield()
  end
  return false
end

-- ---------- running programs ----------
local env = setmetatable({}, { __index = _G })
for k, v in pairs({
  P1 = P1, P2 = P2, F = F, move = M.move, motion = M.motion, press = M.press, hold = M.hold, wait = wait,
  waitNeutral = M.waitNeutral, waitUntil = M.waitUntil, info = M.info, facing = M.facing, log = log,
  setHp = M.setHp, setPower = M.setPower, setX = M.setX,
  r8 = rb, r16 = rw, r32 = rd, w8 = wb, w16 = ww, w32 = wd,
}) do env[k] = v end
M.env = env

-- Start a program (source text). Returns nil or an error message.
function M.run(src, name)
  local fn, err = loadstring(src, name or "injected")
  if not fn then log("compile error: " .. tostring(err)); return err end
  setfenv(fn, env)
  tasks[#tasks + 1] = { co = coroutine.create(fn), name = name or ("program " .. (#tasks + 1)) }
  log("started " .. (name or "program"))
  return nil
end

function M.stopAll()
  if #tasks > 0 then log("stopped " .. #tasks .. " program(s)") end
  tasks = {}
end
function M.running() return #tasks end

-- Advance every program one frame and apply the inputs they asked for. Call once per frame,
-- BEFORE emu.frameadvance(), so the inputs reach that frame.
function M.step()
  pad = {}
  for i = #tasks, 1, -1 do
    local t = tasks[i]
    local ok, err = coroutine.resume(t.co)
    if not ok then log(t.name .. " error: " .. tostring(err)); table.remove(tasks, i)
    elseif coroutine.status(t.co) == "dead" then log(t.name .. " finished"); table.remove(tasks, i) end
  end
  if next(pad) then joypad.set(pad) end
end

return M
