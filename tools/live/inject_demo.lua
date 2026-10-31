-- Standalone move injector demo for FBNeo (no app needed).
-- FBNeo: Game > Lua Scripting > New Lua Script Window > Browse > this file > Run, during a KOF fight.
--
-- It runs my_program.lua from this folder when that file exists, otherwise the demo below.
-- my_program.lua is plain injector code, e.g.:
--     motion(P2, "236A")
--     waitNeutral(P2)
--
-- Helpers (see injector.lua for details):
--   motion(P, "236A")      type a motion; digits are numpad directions relative to facing, then buttons
--   press(P, "6", 20)      hold a direction/buttons for n frames      hold(P, "4")  one frame only
--   move(P, 0x2FCF0)       start a complete move routine now (writes +$198 and +0)
--   wait(n)  waitNeutral(P)  waitUntil(function() return info(P1).air end)
--   info(P) -> state, routine, saved, char, act, frame, animDone, x, y, air, hp, power
--   setHp(P, v)  setPower(P, n)  setX(P, x)   r8/r16/r32  w8/w16/w32   log(...)
-- P1 = $108100, P2 = $108300.

local dir = (debug.getinfo(1, "S").source:match("^@(.*[\\/])")) or ""
local inj = dofile(dir .. "injector.lua")

local f = io.open(dir .. "my_program.lua", "r")
local program
if f then program = f:read("*a"); f:close() end

program = program or [[
-- Generic demo, works with any KOF96-2002 character pair:
log("P2: quarter circle forward + A")
motion(P2, "236A")
waitNeutral(P2)
wait(20)
log("P2: walks forward, then dragon punch motion + C")
press(P2, "6", 20)
motion(P2, "623C")
waitNeutral(P2)
wait(20)
log("P1: 3 power stocks, then a super motion (236236 + A)")
setPower(P1, 3)
-- long motions: 4 frames per step (at 2-3 the two forwards are read as a dash first)
motion(P1, "236236A", 4)
waitNeutral(P1, 600)
log("demo finished")
]]

inj.run(program, "program")
local shown = 0
while true do
  inj.step()
  local out = inj.output()
  for i = shown + 1, #out do print(out[i]) end
  shown = #out
  if #out >= 40 then inj.clearOutput(); shown = 0 end
  emu.frameadvance()
end
