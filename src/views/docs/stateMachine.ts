// Guide: Live tab, memory edits, the move state machine and the Lua injector.
// Everything here was traced in FBNeo from the KOF97 Kyo (P1) vs Iori (P2) savestate; the trace is in
// scripts/data/kof97_kyo_oniyaki_trace.txt and the images come from scripts/statedocs.ts.
import type { Block } from "./DocBlocks";

export const stateMachine: Block[] = [
  { h2: "Live tab & move state machine" },
  { p: "This guide explains what the [Live (emulator)](tab:live) tab shows, which memory to change to get a given result and why it works, and how the game turns a joystick motion into a complete move. With that you can make P1 or P2 do anything from Lua, using the injector built into the live link." },
  { notice: "Addresses are KOF97 and were traced frame by frame in FBNeo (Kyo P1 vs Iori P2). KOF98 and KOF2002 use the same player objects and offsets; only the code addresses move (table in section 7).", info: true },

  { h4: "1. Using the Live tab" },
  {
    ol: [
      "Open HackROM Studio, start the game in FBNeo and run the `hackrom_live.lua` shown in the Live tab (Game → Lua Scripting → New Lua Script Window). Tick **enabled** in the Live tab.",
      "The two **player cards** show, every 3 frames: character, ACT (animation) and frame number, the **state** (`+0`), the **move routine** (`+$198`), HP, power, position, live hit/hurt boxes and the exact tiles on screen.",
      "**Moves the game just executed** lists every routine that went through the dispatcher, with the frame and the player: do a move in the game and read its routine address here.",
      "**P1/P2 moves** lists the decoded move list of the character on screen; ⚡ starts any of them on that player.",
      "**Lua injector** runs small programs that press inputs and change memory frame by frame (section 6).",
      "**RAM** watches, writes and freezes any address. Everything is temporary: reset the game and it is gone.",
    ],
  },
  { fig: { src: "docs/live-players.png", caption: "Player cards and the dispatcher log, connected to FBNeo. After an injected Oniyaki, P1's move routine (+$198) still says $02FCF0 while the state (+0, “next routine”) is back to neutral $00F464." } },

  { h4: "2. Editing memory: what to change and why" },
  { p: "A fighter is a block of RAM (P1 `$108100`, P2 `$108300`). Writing a field changes the game only if the game reads that field after you write it and does not overwrite it first. That is why some edits need a **freeze** (written again every frame) and others work with a single write at the right moment." },
  {
    table: {
      head: ["You want", "Write", "Why it works", "How long"],
      rows: [
        ["Infinite health", "freeze `+$139` = `$67` (KOF2002 `$66`)", "damage subtracts from this byte; freezing puts it back every frame", "while frozen"],
        ["Super meter", "`+$1E3` = 3", "the command handler checks the stock count before a super", "until spent"],
        ["Stop the clock", "freeze `$10A83A` = `$60` (KOF97/98)", "the round timer counts down from this byte", "while frozen"],
        ["Move a fighter", "`+$18` = x", "position is read every frame by the drawing and the box checks", "one write"],
        ["Armor for P1", "P2's `+$E6` bit 0", "the hit reaction is skipped when the attacker has this bit (KOF97)", "while set"],
        ["Start a complete move", "`+$198` and `+0` = routine", "the next frame runs the routine; see section 5", "one write"],
        ["Cancel anything", "`+0` = `$F43E`", "the neutral entry: next frame the fighter stands (checked mid-Oniyaki)", "one write"],
        ["Play an animation only", "`+$72` = ACT", "the animation stepper restarts when `+$72` differs from its copy in `+$78`", "until the ACT ends"],
        ["Change the damage of the attack in progress", "`+$EF` after the move started", "the move routine sets it at its start; a later write wins", "until the next move"],
      ],
      mono: [1],
    },
  },
  { notice: "Writing `+$72` (ACT) alone gives you the animation and its boxes, but not what the move routine does: no jump, no projectile, no new damage value. When that animation ends the fighter stays on its last frame until an input sends it to another state." },

  { h4: "3. The state machine: one routine per frame" },
  { p: "Every object (each fighter, projectile, spark) is a RAM block whose first long, `+0`, is a code address: its **state**. Each frame the main loop walks the object list and calls that address. A state does its work for this frame and, to change state, writes a new address into `+0`; the next frame runs the new state. Nothing else decides what a fighter does." },
  {
    code: `; object loop (main loop, $9DE0): run the state of every object
009DE0  movea.l  d7,a4          ; a4 = object
009DE2  movea.l  (a4),a0        ; a0 = its state (+0)
009DE4  jsr      (a0)           ; run it for this frame
009DE6  move.l   a4,d7
009DE8  move.w   ($4,a4),d7     ; next object in the list
009DEC  bpl.s    $9DE0`,
  },
  { fig: { src: "docs/sm-diagram.svg", caption: "The KOF97 move state machine. The main loop runs +0 of every object; the neutral state calls the character's command handler; a recognised move goes through the dispatcher into its routine, which steps through its phases by rewriting +0 and finally returns to neutral." } },
  { fig: { src: "docs/sm-object.svg", caption: "The fields of a player object you will read and write most. Orange fields control the fighter, blue fields tell you what it is doing." } },
  { p: "**Neutral** (`+0` = `$F464`, entered through `$F43E`) is the state you are in when you can act. Every frame it calls the character's command handler through `+$194` (a per-character block, `+8` = handler), then normals and throws, then the joystick: holding forward switches `+0` to the walk state `$FBC6`, down to the crouch state `$FD02`, and so on." },
  {
    code: `; neutral state (KOF97 $F464), every frame
00F4AC  movea.l  ($194,a4),a0   ; character block
00F4B0  movea.l  ($8,a0),a0     ; its command handler (Kyo $19E3C)
00F4B4  jsr      (a0)           ; motion + button recognised? sets +$198
00F4B6  bne.w    $101D8         ; yes -> dispatcher
        ...                     ; no: normals, throws, walk/crouch/jump

; dispatcher $101D8
0101D8  move.l   (a4),($1C6,a4) ; remember the state we came from
0101DC  movea.l  ($198,a4),a0   ; the move routine
0101E0  jmp      (a0)           ; run it now`,
  },
  { p: "A **move routine** sets everything the move needs in the object, starts the first ACT and changes `+0` to its next phase. Each phase waits for the animation to end (bit 7 of `+$7C`) or for a condition (landing), then starts the next ACT. Kyo's Oniyaki, `$2FCF0`:" },
  {
    code: `02FCF0  jsr      ($1E2FA).l          ; special move start
02FCF6  move.b   ($79,a3),($1A4,a4)  ; which button (A or C)
02FCFC  move.w   #$2C1,d0 / jsr $7700 ; voice
02FD34  move.b   #$1A,($EF,a4)       ; damage (C version: $1C)
02FD40  move.w   #$80,($D2,a4)       ; ACTs of the 3 phases: $80/$82/$84
02FD46  move.w   #$82,($D4,a4)       ;   (C version: $81/$83/$85)
02FD4C  move.w   #$84,($D6,a4)
02FDA2  move.l   #$50000,($50,a4)    ; x speed, +$58 y speed, +$5C gravity
02FDCC  move.w   ($D2,a4),($72,a4)   ; phase 1: ACT = +$D2
02FDD8  jsr      ($584C).l           ; start the animation
02FDDE  move.l   #$2FDE4,(a4)        ; next frame run $2FDE4
02FDE4  tst.b    ($7C,a4)            ; animation finished?
02FDE8  bpl.w    $2FBDA              ; no: keep animating, stay here
02FE02  move.w   ($D4,a4),($72,a4)   ; phase 2: rising, spawns the fire ($1E374)
        ...
02FEBA  move.w   ($D6,a4),($72,a4)   ; phase 3: landing
02FECC  tst.b    ($7C,a4) / bpl $2FBDA
02FED4  jmp      ($1EAD8).l          ; end of move -> neutral`,
  },
  { fig: { src: "docs/sm-kyo-states.svg", caption: "What Kyo showed in each state during the recorded run, rendered by the app from the ROM with the boxes that were live (blue = hurt, red = attack)." } },
  { fig: { src: "docs/sm-iori-hit.svg", caption: "Iori in the same run. Getting hit is the same mechanism: the hit code writes the freeze and hit reaction states into his +0, and the last one sends him back to neutral." } },

  { h4: "4. Reading a move frame by frame" },
  { fig: { src: "docs/sm-timeline.svg", caption: "The recorded run, one column per frame: joystick, P1 state, move routine, saved state, ACT and P2 state. Values are read at the start of each frame." } },
  {
    ul: [
      "**Frames 521-524:** forward is held, the neutral state switches `+0` to walk (`$FBC6`) and the ACT to 1.",
      "**Frames 525-528:** down is held, `+0` becomes the crouch states (`$FD02`, `$FDB4`), ACT `$15`.",
      "**Frame 529:** down-forward + C completes → ↓ ↘ + C; the command handler stores `$2FCF0` in `+$198` and the dispatcher runs (it is reached on 3 consecutive frames until the routine takes over).",
      "**Frame 532:** `+0` = `$2FDE4` (phase 1), `+$1C6` = `$FDB4` (the crouch state it came from), ACT `$81`.",
      "**Frames 537-550:** the uppercut connects. Both fighters' `+0` are replaced by the hit freeze states (`$1633E`, `$163F4`, `$16402`); Iori goes on to `$18A3A` (hit reaction, ACT `$102`) and loses `$10` HP. Kyo's phase state comes back after the freeze.",
      "**Frames 552-603:** phase 2 (`$2FE56`, ACT `$83`), the fall (`$2FE78`, `$2FEAA`) and the landing (`$2FECC`, ACT `$85`).",
      "**Frame 604:** `jmp $1EAD8` puts `+0` back to `$F464`: Kyo can act again.",
    ],
  },

  { h4: "5. Why writing +$198 and +0 starts a move" },
  { p: "The dispatcher does three things: it saves `+0` into `+$1C6`, reads `+$198` and jumps there. Writing the routine address into `+0` makes the object loop call it on the next frame, which is the same as being dispatched; writing it into `+$198` too keeps everything that reads the current move consistent. The routine then sets ACTs, damage, speed and sound itself, so the move is complete: hitboxes, projectiles, power cost and all." },
  {
    ul: [
      "It works from **any** state: in testing it cut into Kyo's knockdown recovery. That is how you build impossible combos, and also how you can break the game, so save a state first.",
      "Use routines of the character in that slot: a routine only stores ACT numbers, so started on another character it would play that character's ACTs with the same numbers (not tested).",
      "Supers still spend power: with 3 stocks, Mu Shiki started by routine left 2.",
      "To stop a move, write the neutral entry (`$F43E` in KOF97) into `+0`.",
    ],
  },

  { h4: "6. Driving a fighter from Lua: the injector" },
  { p: "`tools/live/injector.lua` runs Lua programs inside FBNeo, one step per frame. A program can press inputs (the game reads them like a real joystick), write memory and wait for things to happen. Use it from the **Lua injector** panel in the Live tab, from `tools/live/inject_demo.lua` without the app (put your code in `my_program.lua` next to it), or with `dofile(\"injector.lua\")` in your own script." },
  {
    table: {
      head: ["Function", "What it does"],
      rows: [
        ["`motion(P, \"236A\")`", "presses a motion: numpad digits relative to facing (2 down, 3 down-forward, 6 forward, 4 back…), then the buttons with the last step; 3 frames per step, `motion(P, s, 4)` for 4"],
        ["`press(P, \"6\", 20)`", "holds directions/buttons for n frames (walk, block, charge)"],
        ["`hold(P, \"4\")`", "holds them for this frame only (use inside your own loop)"],
        ["`move(P, 0x2FCF0)`", "starts a complete move routine now (writes `+$198`, `+$1C6` and `+0`)"],
        ["`wait(n)`", "waits n frames"],
        ["`waitNeutral(P, max)`", "waits until the fighter is back to ACT 0 on the ground"],
        ["`waitUntil(function() … end, max)`", "waits until your condition is true"],
        ["`info(P)`", "state, routine, saved, char, act, frame, animDone, x, y, air, hp, power"],
        ["`setHp`, `setPower`, `setX`", "write HP, power stocks, x position"],
        ["`r8 r16 r32 / w8 w16 w32`", "read / write any address"],
        ["`log(…)`", "prints to the injector log (Live tab)"],
      ],
      mono: [0],
    },
  },
  { fig: { src: "docs/live-injector.png", caption: "The Lua injector panel after running the KOF97 demo from the app: each log line comes from the program running inside FBNeo." } },
  { p: "`P1` and `P2` are the object addresses. The facing is worked out from both fighters' x positions, so `6` always means forward. The program is verified in FBNeo on KOF97 (Kyo vs Iori):" },
  {
    code: `motion(P2, "236A")          -- Iori: 108 Shiki Yami Barai (routine $5FC50), hits Kyo
waitNeutral(P2)
move(P1, 0x2FCF0)           -- Kyo: Oniyaki started by its routine
waitNeutral(P1)
press(P2, "6", 20)          -- Iori walks forward 20 frames
motion(P2, "623C")          -- Iori: 100 Shiki Oniyaki ($5F26E), knocks Kyo down
waitNeutral(P2)
setPower(P1, 3)
move(P1, 0x315F8)           -- Kyo: Mu Shiki, cuts into his knockdown recovery
waitNeutral(P1, 600)
log("P2 hp", info(P2).hp)`,
  },
  { p: "Programs can react to the game. An anti-air bot and a state logger:" },
  {
    code: `-- P2 answers every jump of P1
while true do
  if info(P1).air then
    motion(P2, "623C")
    waitNeutral(P2)
  end
  wait()
end

-- log every state change of P1 for 10 seconds
local last
for i = 1, 600 do
  local s = info(P1)
  local k = string.format("%06X/%03X", s.state, s.act)
  if k ~= last then log(string.format("state $%06X ACT %03X", s.state, s.act)); last = k end
  wait()
end`,
  },
  {
    notice: "Timing: specials work at 3 frames per step. For long motions (236236 + A) use 4 frames per step or press the button as its own step (`motion(P, \"236236\")` then `motion(P, \"A\")`); faster, and the two forwards are read as a dash before the super is checked. Checked in KOF97.",
    info: true,
  },

  { h4: "7. Finding the addresses for any character and game" },
  {
    ol: [
      "**Routine of a move:** Characters & moves → Move list (decoded from the command handler), or do the move and read *Moves the game just executed* in the Live tab.",
      "**States of a move:** run the state logger above while doing the move; every `+0` value is one phase. Open them in [68k code](tab:code) to read what each phase does.",
      "**Neutral entry:** the `+0` value while standing still (`$F464` in KOF97); the entry a few bytes before it sets ACT 0 (`$F43E`).",
      "**ACT numbers:** the move list shows the ACTs each routine plays; the routine stores them in `+$D2`, `+$D4`, `+$D6`.",
    ],
  },
  {
    table: {
      head: ["", "KOF97", "KOF98", "KOF2002"],
      rows: [
        ["Dispatcher", "$101D8", "$14854", "$2ECF0"],
        ["Standing state (+0)", "$F464", "$13AC8", "$2DE66"],
        ["Command handler table", "$19DAC", "$1EF56", "$21894"],
        ["Player objects", "$108100 / $108300", "$108100 / $108300", "$108100 / $108300"],
        ["Kyo, starts by routine (checked)", "$2FCF0 (Oniyaki)", "$3C078", "$36EE6 (Oniyaki)"],
      ],
      mono: [1, 2, 3],
    },
  },

  { h4: "8. Good habits" },
  {
    ul: [
      "Save a state before experimenting (Live tab → Save state, or `save quick.fs`): a wrong address in `+0` crashes the game.",
      "Everything is temporary. **■ Stop all programs** stops the injector, and a reset clears every write.",
      "Long programs: keep them in `my_program.lua` and run `inject_demo.lua`, or paste them into the Live tab panel.",
      "Fightcade online: injecting changes your local game only and desyncs the match. Use it offline or in training.",
    ],
  },
];
