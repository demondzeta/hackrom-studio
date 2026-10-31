import { TM_BOX_COLORS } from "../../games/profiles";
import type { Block } from "./DocBlocks";
import { stateMachine } from "./stateMachine";

// All guide pages. English source text; translations live in src/i18n/es.ts and pt.ts keyed by these strings.

const animation: Block[] = [
  { h2: "How a move becomes pixels" },
  { p: "Everything below was read from the real KOF97 ROM and checked in FBNeo. A move is not one thing in the ROM: it is a chain of tables and code. Press a motion and the game walks this chain every frame:" },
  {
    chain: [
      ["Joystick + buttons", "read every frame at $9F68 into $10DA44"],
      ["Command check table", "$A6C00 + char×16 → 13 motions per facing"],
      ["Result bits", "motion recognised → a bit in the result field"],
      ["Command handler", "$19DAC + char×2 → tests bits + buttons"],
      ["Move routine", "stored at object +$198; 68k code = the complete move"],
      ["ACT scripts", "routine plays ACTs ($D2/$D4/$D6…) one after another"],
      ["Frames", "each frame: duration, image id, effect, boxes, cancel"],
      ["Graph entry", "bank 1: image id → x/y offset + image"],
      ["Sprite definition", "$250000 table → tiles + masks"],
      ["C-ROM tiles", "16×16 pixels on screen"],
    ],
  },
  { p: "The [Characters & moves](tab:chars) tab follows the chain: **Move list** (input → routine → ACTs), **Animations** (ACT → frames → boxes → images), **Command inputs** and **Move routines**. The [Live](tab:live) tab shows the same chain running in the emulator.", muted: true },

  { h2: "1. The animation script (ACT)" },
  { p: "An ACT is a list of 6-byte commands in P2 bank 2 (table at `$200002` + char×4 → 512 pointers). Commands are read top to bottom; box/sound/move/effect commands apply to the **next frame** command and stay until replaced. The script ends with `FE` (play once) or `FF` (loop)." },
  { fig: { src: "docs/kyo-farA-act051.png", caption: "Kyo far A (ACT $51), rendered by the app from the ROM. Orange ticks = duration of each frame (3 frames each). Blue = hurt boxes, red = attack box (only frame 2 selects it), dashed = defined but not active on that frame." } },
  { h4: "Frame command" },
  {
    bytes: [
      ["dd", "duration 00-7F (frames at 60 fps)", "#ffb000"],
      ["ee", "effect: hi = hit effect, lo = guard level", "#ff8c00"],
      ["iiii", "image id (2 bytes) → graph entry", "#7fd3ff"],
      ["ss", "box select: lo = slots, hi = flags", "#7777ff"],
      ["cc", "hi = hitstun, lo = cancel", "#3ccf7a"],
    ],
  },
  { h4: "Box command (FD)" },
  {
    bytes: [
      ["FD", "box"],
      ["tt", "type: high 6 bits = kind, low 2 bits = slot 0-3", "#ff5b6b"],
      ["xx", "center x (signed, + = behind the character)"],
      ["yy", "center y (signed, up is negative)"],
      ["ww", "half width"],
      ["hh", "half height"],
    ],
  },
  { p: "A box is a rectangle around (x, y) from the character's feet, ±w wide and ±h tall. Sprites are stored facing **left**; when the character faces right the game mirrors both the sprite and box x. The reach of an attack box is `|x| + w` pixels in front of the character." },
  { h4: "Other commands" },
  {
    table: {
      mono: [0],
      rows: [
        ["FC pp ssss eeee", "play sound `ssss` (e.g. $02C5 Kyo voice)"],
        ["FB pp xxxx yyyy", "move the character (signed x / y)"],
        ["FA kk aaaa bbbb", "extra effect: `3C` = super flash, throws, ranbu"],
        ["FE xx / FF xx", "end of script: once / loop"],
      ],
    },
  },

  { h2: "2. Boxes: kinds, slots and colors" },
  { p: "A frame can carry up to four boxes (slots 0-3). Its **select** byte says which slots are live on that frame (bit 0 = slot 0 … bit 3 = slot 3). The game copies the live boxes into the player object (+$90, +$95, +$9A, +$9F, 5 bytes each) and the box id there is the type ÷ 4. The colors are the ones Fightcade's training mode uses:" },
  {
    legend: [
      [TM_BOX_COLORS.vulnerability, "vulnerability (hurt) — types $00-$27"],
      [TM_BOX_COLORS.guard, "guard / strike invulnerable — $28, $2C, counter $E0/$E4"],
      [TM_BOX_COLORS.attack, "attack — $30-$DC"],
      [TM_BOX_COLORS["proj. vulnerability"], "projectile — $E8-$FC"],
    ],
  },
  { p: "The attack type also decides the reaction: $30 light normal, $34 heavy normal, $40-$5C ground/air knockdowns, $60+ specials (juggle length, close/far), $D8/$DC ranbu. The full list is in the Animations preview." },
  { fig: { src: "docs/kyo-88shiki-actB5.png", caption: "Kyo 88 Shiki (ACT $B5, ↘+D): two attack frames (type $40 = ground heavy, effect $04 = low) with cancel byte $00 — the move cannot be cancelled. Frame 7 lasts 8 frames: the recovery." } },

  { h2: "3. Effects (hit sparks and guard level)" },
  {
    table: {
      head: ["high nibble", "hit effect", "low nibble", "guard level"],
      rows: [
        ["0", "normal (white spark)", "0", "mid (block standing or crouching)"],
        ["1 / 9", "blood (red splatter — checked in FBNeo with $90)", "4", "low (must block crouching)"],
        ["2 / A", "fire", "8", "high / overhead (must block standing)"],
        ["3 / B", "purple flame", "C", "unblockable"],
        ["4 / C", "electric (yellow sparks — checked with $40/$C0)", "+3", "no pushback (3, 7, B, F)"],
        ["5 / D", "fire #2", "", ""],
        ["7 / F", "critical", "", ""],
        ["8", "guard crush (on its own: 8)", "", ""],
      ],
    },
  },

  { h2: "4. Duration, active frames and recovery" },
  { p: "Each frame command shows its image for `dd` frames. **Startup** = the frames before the first frame that selects an attack slot, **active** = frames whose select includes the attack slot, **recovery** = the rest. Make a move faster by lowering startup durations; give it longer reach in time by raising the active frame's duration (checked: far A active 3 → 24 frames keeps the punch out for 24 frames). The hit freeze (hitstop) is added by the game on contact and is not in the script." },

  { h2: "5. Hitstun and cancels (the last byte)" },
  {
    grid: [
      [
        {
          table: {
            head: ["hi", "hitstun on the opponent"],
            rows: [["0", "14 frames (standard)"], ["1", "10"], ["2", "5"], ["3", "11"], ["4", "3"], ["5", "8"], ["6", "47"], ["7", "30"], ["8", "unchanged (projectiles, air)"]],
          },
        },
      ],
      [
        {
          table: {
            head: ["lo", "cancel"],
            rows: [["0", "not cancelable"], ["4", "into specials and supers"], ["8", "into specials only"], ["C", "full cancel (far A uses CC)"], ["+1 / +2", "weaker anti-air juggle / OTG hit"]],
          },
        },
      ],
    ],
  },
  { p: "**How a cancel really happens (traced in the code):** when an attack connects, the hit-freeze code ($163EE) calls `$1E5AA` every frame of the freeze. It reads the cancel nibble of the frame that hit; if it is non-zero it runs the character's command handler, and if you entered a special during the freeze whose type matches (4 = specials+supers, 8 = specials only, C = anything) it buffers that move and starts it when the freeze ends. So: the attack must touch the opponent, and the motion must be finished during the freeze." },

  { h2: "6. Invincibility, armor and counters" },
  {
    ul: [
      "**Invincible frames:** a frame whose select byte has no hurt-box slots (e.g. `01` = only the attack slot, or `00`) has nothing to hit — fully invincible. Checked: 88 Shiki with only slot 0 selected passes through Iori's far C.",
      "**Strike invulnerable:** a box of type `$2C` in a selected slot cancels hurt boxes against strikes but not throws (Kyo's Oniyaki startup).",
      "**Armor:** KOF97 has no armor bit in the ACT. The game skips the hit reaction when the *attacker's* object byte +$E6 has bit 0 set. A small main-loop hook that sets the opponent's +$E6 bit 0 while your move's ACT is playing gives that move armor: you take the damage but keep moving (checked in FBNeo).",
      "**Counter hits:** hurt types $00, $0C, $10, $14, $18, $1C-$24 are counter-hit hurt boxes.",
    ],
  },

  { h2: "7. Complete moves (routines) vs ACTs" },
  { p: "The ACT is only the picture. The **move routine** (68k code) is the complete move: it sets damage (`($EF,a4)`), meter gain, speed (`($50,a4)`), sounds, and chains several ACTs — a super like Kyo's Mu Shiki ($315F8) plays ACTs D0, DB, D2, D7, DC…. The command handler stores the routine at object +$198 and the next routine at +0; writing those two fields starts the move immediately, which is what the Live tab's ▶ trigger does." },
  { fig: { src: "docs/kyo-oniyaki-act080.png", caption: "First ACT of Kyo's Oniyaki ($80): frame 1 has no boxes (invincible startup), frame 2 has a strike-invulnerable $2C box, frame 3 is the fire uppercut (attack $A0, effect $20 = fire, cancel $30). The routine $2FCF0 then plays ACTs $82 and $84." } },

  { h2: "8. Recipes" },
  {
    table: {
      head: ["I want to…", "change", "where"],
      rows: [
        ["extend a hitbox", "attack box `w`/`h` (reach = |x|+w)", "Animations → FD box row"],
        ["make a move cancelable", "cancel nibble of its attack frames → 4 / 8 / C", "Animations → frame row “stun/cxl”"],
        ["make it invincible", "remove hurt slots from select (keep the attack slot)", "Animations → frame row “sel”"],
        ["give it armor", "hook: opponent +$E6 bit 0 while the ACT plays", "Main loop & hooks (Tutorial 16)"],
        ["change the hit effect", "effect high nibble (4 = electric, 9 = blood)", "Animations → frame row “eff”"],
        ["make it unblockable / overhead / low", "effect low nibble (C / 8 / 4)", "Animations → frame row “eff”"],
        ["longer active frames", "duration of the attack frame", "Animations → frame row “dur”"],
        ["more damage", "`move.b #x,($EF,a4)` in the routine", "Move routines → clone"],
        ["different input", "motion steps / window", "Command inputs"],
        ["try any of these without rebuilding", "⚡ Try live", "Live tab connected to FBNeo"],
      ],
    },
  },
];

const live: Block[] = [
  { h2: "Live emulator link (temporary changes)" },
  { p: "The app can drive a running FBNeo (Fightcade's FBNeo included): read the game state every frame, write RAM, freeze values, start moves, and even patch the program ROM in memory. Nothing is saved: reset or close the game and everything is back to the original. Use it to try ideas in seconds, then make them permanent with the normal editors." },
  { h4: "How it is connected" },
  {
    arrow: "⇄",
    chain: [
      ["HackROM Studio", "Live tab, ⚡ buttons"],
      ["Live bridge", "/__live endpoints"],
      ["%TEMP% files", "hackrom_live_cmd.txt / _state.txt"],
      ["hackrom_live.lua", "runs inside FBNeo every frame"],
    ],
  },
  { h4: "Setup (once per session)" },
  {
    ol: [
      "Open HackROM Studio (or run `npm run dev` in the `app` folder when working on the source).",
      "Start KOF97 in FBNeo. For a safe test, use a copy of Fightcade's FBNeo with its own ROMs folder (see Guides → Testing).",
      "In FBNeo: **Game → Lua Scripting → New Lua Script Window → Browse** → the `hackrom_live.lua` path shown in the Live tab → **Run**.",
      "Open the [Live (emulator)](tab:live) tab and tick **enabled**. The top bar shows a green “live” dot.",
    ],
  },
  { h4: "What you can do live" },
  {
    table: {
      head: ["Where", "Live action", "How it works"],
      rows: [
        ["Live tab", "P1/P2 state: character, ACT, frame, move routine, HP, power, position", "read from the player objects $108100 / $108300"],
        ["Live tab", "Image and **tiles on screen right now** with their C-ROM file offsets (click to open the tile)", "object +$28 → graph entry → image → sprite definition"],
        ["Live tab", "Moves the game just executed", "watch on the dispatcher $101D8 (routine at +$198)"],
        ["Live tab / Move list / Move routines", "▶ trigger any complete move on P1 or P2", "writes the routine to +$198 and +0, like the command handler does"],
        ["Live tab", "RAM watch, write, freeze (HP, power, timer, ACT, inputs…)", "memory writes every frame"],
        ["Live tab", "Hitbox overlay in the emulator window (training mode colors)", "drawn by the Lua script"],
        ["Live tab", "⚡ Push my ROM edits live / restore originals", "FBNeo's memory.writebyte can write program ROM; banked P2 data is written when its bank is mapped"],
        ["Animations", "⚡ Try live / Restore live for the edited script", "same, only that script"],
        ["Command inputs", "⚡ Try live", "writes the motion definition"],
        ["Move routines", "⚡ Assemble live + trigger P1, ⚡ P1 on each routine", "puts new code in ROM memory and starts it"],
        ["68k code, Hex editor", "⚡ Live patch", "writes the bytes at that address"],
        ["Main loop & hooks", "⚡ Install live", "writes hook code + jump"],
        ["Palettes", "⚡ Send this palette (palette RAM #, Kyo P1 = $010)", "writes palette RAM $400000 + n×32"],
        ["Sprite tiles, Fix layer, sound", "— not live", "graphics/sound ROMs are not on the 68k bus: export and reload"],
      ],
    },
  },
  { p: "To make P1/P2 perform moves from Lua and to understand the state machine behind every move, read **Live tab & move state machine**." },
  { h4: "Lua commands (for your own scripts)" },
  { p: "`w8/w16/w32 ADDR VAL` · `wb ADDR HEX` · `wbb BANKID ADDR HEX` · `freeze SIZE ADDR VAL` · `unfreeze ADDR` · `unfreezeall` · `watch ADDR LEN` · `clearwatch` · `trigger OBJ ROUTINE` · `pal N HEXWORDS` · `overlay 0|1` · `save FILE` · `load FILE` · `lua CODE` · `luastop`", muted: true },
];

const basics: Block[] = [
  { h2: "How a Neo Geo cartridge is organised" },
  {
    ul: [
      "**P ROMs** — 68000 program. P1 is mapped at $000000–$0FFFFF. Bigger games (KOF97: 4MB P2) page extra 1MB banks into $200000–$2FFFFF by writing to $2FFFF0. KOF tags each bank with its number in the first word (0001, 0002…).",
      "**C ROMs** — sprite graphics, in pairs (c1+c2, c3+c4…). Each 16×16 tile is 128 bytes: 64 in the odd file (bit planes 0–1) and 64 in the even file (planes 2–3). Tile number N lives at offset N×64 in both files of its pair.",
      "**S ROM** — fix layer: 8×8 tiles for text and HUD, 32 bytes each.",
      "**M1 / V ROMs** — Z80 sound driver and ADPCM samples (kept as-is).",
      "**Palettes** are not in their own ROM: the game copies 16-color palettes from P ROM into palette RAM. Each sprite chooses one of 256 palettes; color 0 is transparent.",
    ],
  },
  { h2: "Workflow" },
  {
    ol: [
      "Load the set in [ROM set](tab:home) (MAME zip or loose files). The game is detected from the header (NGH number).",
      "Edit graphics, palettes, animations, inputs or code. Every change is undoable (Ctrl+Z) and listed in [Build & export](tab:export).",
      "Download the patched zip and run it in MAME or FBNeo, or save a project/IPS to keep only your changes.",
    ],
  },
  { notice: "Program ROMs from MAME are stored word-swapped. The editor shows them in 68k order and swaps them back on export, so addresses in this app match the MAME debugger." },
];

const graphics: Block[] = [
  { h2: "Find a character's graphics" },
  {
    ol: [
      "Open [Palettes](tab:palettes) and pick the character (KOF97/98 have a named list). The active palette is shown in the top bar and used by every graphics view.",
      "Open [Sprite tiles](tab:tiles). Every tile shows its tile number and the exact c-file offsets. Double-click a tile to edit pixels.",
      "A frame is several tiles: Neo Geo sprites are 16 px wide columns, tiles go downwards and characters chain columns. Use [Frame builder](tab:sprites) with the first tile number, columns and rows to see the whole frame.",
      "With the emulator connected, the [Live](tab:live) tab lists the exact tiles on screen for each player.",
    ],
  },
  { h2: "Change colors" },
  { p: "In Palettes click a swatch and use the sliders/picker. Neo Geo colors are 5:5:5 plus a shared “dark” bit. KOF stores 4 color variants (A/B/C/D) per character, each 16 palettes." },
  { h2: "Import new art" },
  {
    ul: [
      "Draw with ≤15 colors + transparent. PNG width/height should be multiples of 16.",
      "Sprite tiles → select a tile → *Import PNG* writes the picture there (row by row). Frame builder → *Import PNG frame* finds empty tile space for you and writes the frame in column order.",
      "“Import + build new palette” creates a palette from your image; write it over a character's color set to use it.",
    ],
  },
];

const moves: Block[] = [
  { h2: "KOF animation scripts (ACT)" },
  { p: "Every animation is an ACT: a list of 6-byte commands in the P2 ACT bank. See **Animation system (KOF)** for the full explanation with images." },
  {
    table: {
      mono: [0],
      rows: [
        ["dd ee iiii ss cc", "Frame: duration dd (frames), effect ee (high nibble = hit effect: blood/fire/electric…, low = high/low/unblockable), image id iiii, ss = box select (low nibble = which box slots are live, high = flags such as superflash), cc = hitstun (high) + cancel type (low)."],
        ["FD tt xx yy ww hh", "Box: type tt (low 2 bits = slot 0–3, rest = judgment type: hurt, attack, guard, projectile…), center x/y relative to the character, half width/height."],
        ["FC pp ssss eeee", "Sound effect."],
        ["FB pp xxxx yyyy", "Movement."],
        ["FA kk aaaa bbbb", "Extra image effect (3C = superflash, throws, ranbu)."],
        ["FE xx / FF xx", "End (play once / loop)."],
      ],
    },
  },
  { p: "In [Characters & moves](tab:chars) pick a character and an ACT: the preview draws the boxes per frame (solid = active for that frame), the timeline shows timing, and every field can be edited. Writing a longer script moves it to free space and repoints the ACT." },
  { h2: "Command inputs" },
  { p: "The command parser compares the input history with per-character tables of 13 motion definitions (`count, window, charge, then [compare mode, input]…`). Edit directions/buttons, the input window and the compare modes in *Command inputs*. A recognised motion sets a bit; the character's command handler then stores a move routine at object+$198 and jumps to it." },
  { h2: "Frame data notes (KOF97)" },
  {
    ul: [
      "Hitstun: 0=14f 1=10f 2=5f 3=11f 4=3f 5=8f 6=47f 7=30f 8=unchanged.",
      "Cancel: 0 none, 4 special+super, 8 special only, C full; +1 weak anti-air juggle, +2 OTG.",
      "A frame with select 00 and no boxes is fully invincible (that's how many supers get invincibility).",
    ],
  },
];

const newMove: Block[] = [
  { h2: "Create or change a special move" },
  {
    steps: [
      "**1. Animation.** In Characters & moves pick an ACT similar to what you want, edit frames/boxes and use *Copy to ACT slot…* to put a copy into an unused ACT number. New frames can use new images: import them with the Frame builder.",
      "**2. Routine.** Characters & moves → *Move routines*. Clone the routine of a similar move. The cloner follows branches and the “continue next frame” pointers (`move.l #addr,(a4)`) and turns them into labels, so you can change ACT numbers (`($D2,a4)`…), damage (`($EF,a4)`), speed (`($50,a4)`), sounds and assemble it anywhere in free P1 space. Or start from the template.",
      "**3. Input.** Either repoint an existing assignment (*Repoint … to the new routine*) so an existing motion triggers your move, or edit a motion definition in Command inputs, or trigger it from your own code (next section).",
      "**4. Test.** With the emulator connected use ⚡ Assemble live + trigger P1. Or build the zip and run it in MAME with the debugger (`mame kof97 -debug`), break on your routine address (e.g. `bp 2FCF0` for Kyo's Oniyaki) and watch P1's ACT at $108172.",
    ],
  },
];

const newChar: Block[] = [
  { h2: "Adding a full character" },
  { p: "KOF has a fixed number of character slots, so the practical way to add a character is to **replace a slot** (e.g. a boss, a duplicate like Orochi Iori/Leona, or a less used fighter) or to extend the tables with free space. A character is spread over these pieces:" },
  {
    table: {
      head: ["Piece", "Where (KOF97)", "Tool here"],
      rows: [
        ["Sprite tiles", "C ROMs (free tile runs or replace the old character's tiles)", "Frame builder import, Sprite tiles"],
        ["Palettes (4 variants × 16)", "P2 bank 2, e.g. $2D1FF0 + n×$800 (color 0 first)", "Palettes"],
        ["Frame list (image id → offset + image)", "graph bank (id 0001): table at $200002 + char×4, 6 bytes per frame", "Characters & moves (preview)"],
        ["Image definitions (tiles per frame)", "graph bank image tables ($250000 + char×4)", "Frame builder"],
        ["Animations + boxes", "ACT bank (id 0002): table at $200002 + char×4 → 512 ACT pointers", "Characters & moves"],
        ["P1 ACT number map", "$AFBCA + char×4", "Characters & moves"],
        ["Command inputs", "$A6C00 + char×16 (left/right tables)", "Command inputs"],
        ["Move routines + command handler", "P1 code; handler at $19DAC + char×2, routine pointer at +$198", "Move list, Move routines, 68k code"],
        ["Sounds / voices", "M1 + V ROMs, called through sound codes (FC commands)", "Hex (advanced)"],
        ["Select screen, portraits, names, win quotes", "Portrait slot ($22), fix layer, P1 tables", "Tiles, Fix layer, Hex"],
      ],
    },
  },
  { h2: "Step by step (replacing a slot)" },
  {
    ol: [
      "**Graphics:** export the old character's frames as PNG (Frame builder), redraw them, import them back into the same tiles or into free tile space. Keep the same frame sizes to reuse the existing image definitions.",
      "**Palettes:** write your 4 color variants over the slot's palette set.",
      "**Animations:** adjust each ACT's frame timing and boxes for the new art; add new ACTs into free slots with “Copy to ACT slot”.",
      "**Moves:** rewrite command definitions and clone/modify move routines as in “New move”.",
      "**Test every ACT** in the emulator: idle, walk, jumps, normals, specials, supers, hit reactions, throws, win/lose poses.",
    ],
  },
  { notice: "Adding a *new* slot (instead of replacing one) also needs the select screen grid, team tables, the char count checks in code and the per-character pointer tables extended — doable with the hex/code tools but specific to each game. Start by replacing a slot." },
];

const hooks: Block[] = [
  { h2: "Running your code every frame" },
  {
    ol: [
      "Open [Main loop & hooks](tab:hooks). For KOF97 the known main loop ($9C38, loop at $9C44) is shown; for other games press *Analyse* to rank loop candidates.",
      "Pick a hook site inside the loop (an instruction boundary with ≥6 bytes of straight code that isn't PC-relative — the builder checks this).",
      "Pick free space in P1 for the hook code, choose a template or write your code, and install (or ⚡ Install live to try it first).",
    ],
  },
  { p: "The site is replaced by `jmp hook`. The hook runs your code, re-runs the replaced instructions and jumps back, so the game keeps working. Templates include timer freeze, infinite health, armor while an ACT plays, debug markers and a “button combo starts a move routine” example." },
  { h2: "Patching single instructions" },
  { p: "In [68k code](tab:code) select an instruction, type new assembly and press Write. Shorter code is padded with NOPs." },
];

const testing: Block[] = [
  { h2: "Testing in an emulator" },
  {
    ul: [
      "Put the exported zip in its own folder: `mame kof97 -rompath my_hack`. Edited files report wrong checksums but the game runs.",
      "`-debug` opens the MAME debugger. Useful commands: `bp 12914` (break on command check), `wp 108172,2,w` (watch P1 ACT changes), `dump`.",
      "KOF97 debug dips at $100000 (checked in FBNeo): $02 draws object position markers, $04 player info, $80 opens the hidden debug menus. For hit/hurt boxes use the Live tab overlay or Fightcade's training mode hitbox viewer.",
      "FBNeo: don't overwrite Fightcade's ROM. Use a separate FBNeo folder with its own ROMs folder; press OK on the “modified ROM” warning. Savestates of the original game still load; palette edits show from the next round.",
      "Keep the original zip: you can always reload it, apply your project file, and rebuild.",
    ],
  },
];

export const GUIDE_SECTIONS: { id: string; title: string; blocks: Block[] }[] = [
  { id: "anim", title: "Animation system (KOF)", blocks: animation },
  { id: "live", title: "Live emulator link", blocks: live },
  { id: "statemachine", title: "Live tab & move state machine", blocks: stateMachine },
  { id: "basics", title: "Basics", blocks: basics },
  { id: "graphics", title: "Graphics & palettes", blocks: graphics },
  { id: "moves", title: "Moves & hitboxes", blocks: moves },
  { id: "newmove", title: "New move", blocks: newMove },
  { id: "newchar", title: "New character", blocks: newChar },
  { id: "hooks", title: "Main loop & hooks", blocks: hooks },
  { id: "testing", title: "Testing", blocks: testing },
];
