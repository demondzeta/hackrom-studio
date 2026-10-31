// Hands-on tutorials. Text uses `code` and **bold** markup (rendered in the app and exported as Markdown).
// Every KOF97 example was applied with src/tutorials/examples.ts and checked in FBNeo from a savestate.
import type { RomSet } from "../core/romset";
import type { Tab } from "../store";
import type { ExampleId } from "./examples";
import { tr } from "../i18n";

export type GoTarget = { tab: Tab } | { code: number } | { hex: number; bank?: number } | { tile: number };

export interface TutorialStep {
  text: string;
  go?: GoTarget;
  goLabel?: string;
  /** returns true when the step's edit is present in the loaded ROM */
  check?: (rs: RomSet) => boolean;
}

export interface Tutorial {
  id: string;
  section: string;
  title: string;
  summary: string;
  time: string;
  steps: TutorialStep[];
  example?: ExampleId;
  shots?: { src: string; caption: string }[];
  result?: string;
  notes?: string[];
}

export function modifiedRange(rs: RomSet, addr: number, len: number, bank = 0): boolean {
  for (let i = 0; i < len; i++) {
    const l = rs.cpuToFile(addr + i, bank);
    if (l && rs.files[l.file].data[l.offset] !== rs.files[l.file].orig[l.offset]) return true;
  }
  return false;
}
const anyModified = (role: string) => (rs: RomSet) => rs.files.some((f, i) => f.role === role && rs.isModified(i));
const actBank = (rs: RomSet) => Math.max(0, rs.bankById(2));

export const TUTORIALS: Tutorial[] = [
  {
    id: "start",
    section: "Start here",
    title: "1. Load a ROM set and find your way around",
    summary: "Open KOF97, read the ROM set page, understand undo/redo and where your edits go.",
    time: "3 min",
    steps: [
      { text: "Open **ROM set** and drop your `kof97.zip` (from Fightcade: `Fightcade\\emulator\\fbneo\\ROMs\\kof97.zip`). Nothing is uploaded and the zip on disk is never changed.", go: { tab: "home" } },
      { text: "Check the **Game** card: it should say The King of Fighters '97, NGH `0232`, profile **documented**, and list 4 program banks with ids `0000 0001 0002 0003`." },
      { text: "Look at **Entry points**: `USER $009868`, VBlank `$009EA2`. These are where the BIOS hands control to the game." },
      { text: "Every edit you make is listed in **Build & export → Edit history** and can be undone with **Ctrl+Z** (redo **Ctrl+Y**).", go: { tab: "export" } },
      { text: "No ROM yet? Press **Try the synthetic demo set** on the ROM set page: it is generated data laid out like KOF97, safe to break." },
    ],
  },
  {
    id: "palette",
    section: "Graphics",
    title: "2. Recolor a character (palettes)",
    summary: "Change Kyo's jacket from green to blue by editing his palette in P2 ROM.",
    time: "5 min",
    example: "palette",
    steps: [
      { text: "Open **Palettes**. In the library on the left find **KYO KUSANAGI** and press **A**. The browser jumps to `$2D1FF0` (bank 2) and makes it the active palette.", go: { tab: "palettes" } },
      { text: "Row `$2D1FF0` is Kyo's main palette. Colors **7 to 12** are the jacket and trousers (dark greens). Click color 7." },
      { text: "Drag the **B** slider up and **G** down, or use the color picker. Repeat for colors 8-12 going lighter each time.", check: (rs) => modifiedRange(rs, 0x2d1ff0, 32, actBank(rs)) },
      { text: "Open **Sprite tiles** or **Characters & moves**: everything drawn with the active palette updates immediately.", go: { tab: "chars" } },
      { text: "Export and run. In KOF97 the palette is copied to palette RAM when a round starts, so a savestate taken mid-round shows the old colors until the next round." },
    ],
    shots: [
      { src: "tutorials/original.png", caption: "Original (savestate, round 1)" },
      { src: "tutorials/palette-after.png", caption: "After the edit, round 2 in FBNeo: blue jacket" },
    ],
    result: "Verified in FBNeo: after a KO the next round reloads palette $010 from ROM and Kyo appears in blue.",
  },
  {
    id: "tiles",
    section: "Graphics",
    title: "3. Edit sprite tiles",
    summary: "Find the tiles of Kyo's idle frames and draw on them.",
    time: "5 min",
    example: "tiles",
    steps: [
      { text: "Set Kyo's palette first (tutorial 2, step 1) so tiles show real colors." },
      { text: "Open **Characters & moves → Animations**, pick **Kyo**, ACT **000** (idle). Expand **Sprite preview setup**: it shows `frame $0000 → graph … → def $250092 … 5×7 tiles from $10000`.", go: { tab: "chars" } },
      { text: "Go to tile `$10000` in **Sprite tiles**: that's the first tile of Kyo's idle frame. Each tile shows its c1/c2 file offsets.", go: { tile: 0x10000 }, goLabel: "Open tile $10000" },
      { text: "Double-click a tile, paint with color 1 (white), press **Write to ROM**.", check: anyModified("c") },
      { text: "Shift+click to select a block and use **Export PNG** / **Import PNG** to edit many tiles in an image editor." },
    ],
    shots: [
      { src: "tutorials/original.png", caption: "Original" },
      { src: "tutorials/tiles-after.png", caption: "White marks drawn on Kyo's chest tiles (FBNeo)" },
      { src: "tutorials/kyo-frames.png", caption: "Kyo frames decoded by the app (idle 0-2, Oniyaki E1-E3)" },
    ],
    result: "Verified in FBNeo: graphics are read live from C ROM, so tile edits show immediately, even from a savestate.",
  },
  {
    id: "frames",
    section: "Graphics",
    title: "4. Build and import a frame",
    summary: "Turn a PNG into tiles in free space, ready to be used by a new animation.",
    time: "10 min",
    steps: [
      { text: "Open **Frame builder**. Set base tile, columns and rows to look at any block of tiles (Neo Geo sprites are 16 px wide columns).", go: { tab: "sprites" } },
      { text: "KOF96-98 frames store a row mask per column, so a real frame is not always a plain rectangle; the Characters preview decodes them exactly (tutorial 3, step 2)." },
      { text: "Draw a frame (max 15 colors + transparent, size in multiples of 16 px) and press **Import PNG frame (use active palette)**. The app finds empty tiles and writes the frame there.", check: anyModified("c") },
      { text: "Note the base tile shown in the message: that's where your frame lives. Use **Import + build new palette** to also generate a palette for it." },
    ],
  },
  {
    id: "framepng",
    section: "Graphics",
    title: "22. Replace a character's sprite frame with your own PNG",
    summary: "Export one of Kyo's frames exactly as the game stores it, redraw it, and import it back into the same tiles.",
    time: "15 min",
    example: "framepng",
    steps: [
      { text: "Open **Characters & moves → Animations**, pick **Kyo** and ACT **051** (far A). Click frame **#2** in the timeline: image `$3D`, the punch.", go: { tab: "chars" } },
      { text: "Expand **Sprite preview setup**: the tile layout must be **per-column row masks (KOF96-98)**. It shows `def $25046E … 6×7 tiles`. Press palette **A** there so the export uses Kyo's colors." },
      { text: "Press **Export frame PNG** under the preview. You get a 96×112 px indexed PNG with Kyo's 16 colors, facing left as stored. Faint pink cells have no tile in this frame: only 22 of the 42 cells exist." },
      { text: "Redraw it in any pixel editor (Aseprite, GIMP, Photoshop in indexed mode…). Keep the size, keep transparency, use only the palette colors (others are matched to the nearest one) and stay out of the pink cells." },
      { text: "Press **Import PNG into this frame** and pick your file. Only pixels that changed are written, into the same tiles the frame already uses. The message says how many tiles changed and how many pixels fell in cells without a tile (those are ignored).", check: anyModified("c") },
      { text: "If some of the tiles are shared with other images (Kyo's idle frames share tiles, for example) the app lists them and asks first, because those images change too." },
      { text: "Importing the PNG you exported without editing it writes nothing: a good way to check your editor keeps the colors exact. Then **Build & export** and test in FBNeo (tutorial 12).", go: { tab: "export" } },
    ],
    result: "Verified on the real kof97 set: exporting and importing frames unchanged gives a zero byte difference in the C ROMs, and a painted edit only changes bytes inside the frame's own tiles.",
    notes: ["KOF97 has almost no empty tiles left in its C ROMs, so new art has to reuse the tiles a frame already has. To give a frame more tiles you need a new sprite definition (tutorial 4 shows how to place new tiles)."],
  },
  {
    id: "act",
    section: "Characters & moves",
    title: "5. Edit an animation and its hitboxes (ACT)",
    summary: "Make Kyo's idle stance use another image and give it a giant hurt box.",
    time: "10 min",
    example: "act",
    steps: [
      { text: "Open **Characters & moves → Animations**, select **Kyo** and ACT **000**. Press **Play**: the timeline shows 10 frames with their durations; boxes are drawn per frame (solid = active).", go: { tab: "chars" } },
      { text: "Click any **frame** row in the script. The `img` field is the image id. Change every frame's img to `E3` (an Oniyaki pose)." },
      { text: "Find the **FD box** rows. The type's low 2 bits are the slot; slot 1 is a hurt box. Set its `w` to 40 and `h` to 50 (half sizes)." },
      { text: "Press **Write to ROM**. If a script grows it is moved to free space automatically.", check: (rs) => modifiedRange(rs, 0x21191a, 0x60, actBank(rs)) },
      { text: "Try others: ACT `080` is Oniyaki — its frame 3 has the attack box (type `A0`, slot 0), effect `20` (fire) and cancel `30`." },
    ],
    shots: [
      { src: "tutorials/act-before.png", caption: "Original idle with the box overlay" },
      { src: "tutorials/act-after.png", caption: "Idle shows image E3 and the 40×50 hurt box (FBNeo)" },
    ],
    result: "Verified in FBNeo: ACT scripts are read live, the new pose and box appear immediately.",
    notes: ["Box overlay in the screenshots is drawn by a Lua script with the same RAM layout as Fightcade's training mode hitbox viewer (object +$90/$95/$9A/$9F)."],
  },
  {
    id: "command",
    section: "Characters & moves",
    title: "6. Change a special move's input",
    summary: "Make Kyo's Oniyaki come out with down, down + any button.",
    time: "5 min",
    example: "command",
    steps: [
      { text: "Open **Characters & moves → Command inputs**, press **Scan** (55 tables in KOF97). Table `$A6E38` is Kyo facing right.", go: { tab: "chars" } },
      { text: "Slot **5** points to `$A7CD2`: **→ ↓ → any**, window 14 — that's Oniyaki (623+P)." },
      { text: "Change the first three directions to **↓** and keep the last step as any button. Press **Write to ROM**.", check: (rs) => modifiedRange(rs, 0xa7cd2, 12) },
      { text: "Compare modes matter: `14` = contains the direction (lenient), `28`/`00` stricter, `04` with `F0` = any button. Lower windows make motions harder." },
    ],
    shots: [
      { src: "tutorials/command-before.png", caption: "Original: down, down+A = crouching normal" },
      { src: "tutorials/command-after.png", caption: "Edited: down, down+A = Oniyaki (FBNeo)" },
    ],
    result: "Verified in FBNeo: with the edit, P1 ACT becomes $080 (Oniyaki) and Iori takes 2 hits.",
  },
  {
    id: "routine",
    section: "Characters & moves",
    title: "7. Clone a move routine and change its damage",
    summary: "Copy Kyo's Oniyaki code into free space, make it hit harder and point the move to the copy.",
    time: "10 min",
    example: "routine",
    steps: [
      { text: "Open **Characters & moves → Move routines**. Filter `2FCF0`: the row **set at $019F1A → routine $02FCF0** is Kyo's Oniyaki. (`$2FEDA` is his Red Kick.)", go: { tab: "chars" } },
      { text: "Press **clone**. The routine (105 instructions) appears as editable assembly; branches and next-frame pointers are labels like `L_02FDE4`." },
      { text: "Find the lines `move.b #$1A,($EF,a4)` / `#$1C` / `#$1B` (damage) and change them to `#$60`." },
      { text: "Pick free space (e.g. `$0F0400`) in **assemble at**, press **Assemble & write**, then **Repoint 019F1A to the new routine**.", check: (rs) => modifiedRange(rs, 0x19f1c, 4) },
      { text: "Open the new address in **68k code** to read your routine.", go: { code: 0xf0400 }, goLabel: "View $F0400" },
    ],
    shots: [
      { src: "tutorials/routine-before.png", caption: "Original Oniyaki damage" },
      { src: "tutorials/routine-after.png", caption: "Cloned routine at $F0434: much more damage (FBNeo)" },
    ],
    result: "Verified in FBNeo: P1's move routine pointer ($108298) reads $0F0434 and Iori loses $19 instead of $0D health.",
  },
  {
    id: "code",
    section: "Code",
    title: "8. Read and patch 68k code",
    summary: "Follow the main loop, label routines and patch an instruction.",
    time: "10 min",
    steps: [
      { text: "Open **68k code** at `$9C38` (MainLoop_Entry). `$9C50 tst.b ($2785,a5) / beq` waits for VBlank, `$9C5C bsr $9F68` reads inputs.", go: { code: 0x9c38 }, goLabel: "Open $9C38" },
      { text: "Double-click `bsr.w $9F68` to follow it, **←** to go back. Click **Find references** to see who calls a routine." },
      { text: "Use **☆ Bookmark / label** to name routines you understand; labels show everywhere." },
      { text: "Patch: select an instruction, type new assembly (e.g. `nop`) and press **Write**. Shorter code is padded with NOPs; red bars mark modified lines." },
      { text: "Open `$101D8`: `movea.l ($198,a4),a0 / jmp (a0)` — this is where a recognised special move jumps to its routine.", go: { code: 0x101d8 }, goLabel: "Open $101D8" },
    ],
  },
  {
    id: "hook",
    section: "Code",
    title: "9. Run your own code every frame (main loop hook)",
    summary: "Freeze the round timer by hooking the main loop.",
    time: "5 min",
    example: "hook",
    steps: [
      { text: "Open **Main loop & hooks**. The known KOF97 loop is shown; the hook site defaults to `$9C44` (`move.b #$0,($2785,a5)`, 6 relocatable bytes).", go: { tab: "hooks" } },
      { text: "Choose free space in P1 (e.g. `$0F0000`) and the template **Freeze round timer** (`move.b #$60,$10A83A`)." },
      { text: "Read the listing: the site becomes `jmp $0F0000`; the hook saves registers, runs your code, re-runs the moved instruction and jumps back to `$9C4A`." },
      { text: "Press **Install hook**.", check: (rs) => modifiedRange(rs, 0x9c44, 6) },
      { text: "Other templates: P1 infinite health (`$108239`), max power, or a button combo that starts a move routine." },
    ],
    shots: [
      { src: "tutorials/hook-before.png", caption: "Original after 20 seconds" },
      { src: "tutorials/hook-after.png", caption: "Hooked: timer stays at 60 (FBNeo)" },
    ],
    result: "Verified in FBNeo: the timer stays at 60 for the whole run.",
  },
  {
    id: "fix",
    section: "Graphics",
    title: "10. Edit the HUD font (fix layer)",
    summary: "Change the 8×8 text tiles used for names, CREDITS and messages.",
    time: "5 min",
    example: "fix",
    steps: [
      { text: "Open **Fix layer** and go to tile `$300`: KOF97's font starts here; the CREDITS text is at `$3E0`.", go: { tab: "fix" } },
      { text: "Double-click a letter tile, edit it and **Write to ROM**.", check: anyModified("s") },
      { text: "Use **Export page PNG** to see a whole page of font tiles at once." },
    ],
    shots: [
      { src: "tutorials/original.png", caption: "Original HUD" },
      { src: "tutorials/fix-after.png", caption: "Font tiles $300-$3FF mirrored (FBNeo)" },
    ],
    result: "Verified in FBNeo: the HUD text is drawn mirrored right away.",
  },
  {
    id: "hex",
    section: "Code",
    title: "11. Search and edit raw bytes",
    summary: "Use patterns to find every character's code at once.",
    time: "5 min",
    steps: [
      { text: "Open **Hex editor**, file `232-p1.p1`. Search `397C 0080 00D2` (`move.w #$80,($D2,a4)`): 30 hits, one per character's ACT $80 special.", go: { tab: "hex" } },
      { text: "Go to offset `$A7CD2` to see the Oniyaki command bytes `04 0E 00 00 14 08 28 02 04 08 04 F0`.", go: { hex: 0xa7cd2 }, goLabel: "Open $A7CD2" },
      { text: "Click a byte and type to overwrite it. Modified bytes turn red; the cursor panel shows the 68k address and the original value." },
    ],
  },
  {
    id: "readact",
    section: "Moves in depth",
    title: "13. Read an animation frame by frame",
    summary: "Understand duration, image, effect, boxes and cancel of every frame of Kyo's far A.",
    time: "10 min",
    steps: [
      { text: "Read **Guides & docs → Animation system (KOF)** first: it shows how input → handler → routine → ACT → frames → tiles fit together.", go: { tab: "guide" } },
      { text: "Open **Characters & moves → Animations**, pick **Kyo** and ACT **051** (far A). Under *Sprite preview setup* pick Kyo's palette **A**.", go: { tab: "chars" } },
      { text: "The script has 3 frames of 3 frames each. Frame 2 (image `$3D`) selects slots 0+1+2 (`sel 07`); slot 0 is the red attack box: type `30` (light normal), x `-36`, y `-84`, half size `28×8`, so it reaches 36+28 = 64 px in front." },
      { text: "Its last byte is `cc`: hitstun C, cancel C (full cancel) — that is why far A cancels into anything. Frame 3 goes back to hurt boxes only." },
      { text: "Press **▶ Play** and watch the timeline: orange = duration, HIT marks the active frame. Compare with ACT `0B5` (88 Shiki): two attack frames, cancel `00`." },
    ],
    shots: [{ src: "docs/kyo-farA-act051.png", caption: "Kyo far A rendered by the app: duration ticks, hurt boxes (blue), attack box (red), inactive boxes dashed" }],
  },
  {
    id: "hitbox",
    section: "Moves in depth",
    title: "14. Extend a hitbox",
    summary: "Give Kyo's far A a punch that reaches across the screen.",
    time: "5 min",
    example: "hitbox",
    steps: [
      { text: "Open **Animations**, Kyo, ACT **051**. Click the **FD box** row with type `30` (slot 0, attack).", go: { tab: "chars" } },
      { text: "Reach = |x| + w = 36 + 28 = 64 px. At round start the fighters are 160 px apart and Iori's body box is 20 px wide, so you need |x| + w ≥ 140: set **w = 120** (reach 156). Height is h (half height)." },
      { text: "Press **Write to ROM** (or **⚡ Try live** with the emulator connected).", check: (rs) => modifiedRange(rs, 0x21230a, 56, actBank(rs)) },
      { text: "Bigger boxes also need the opponent's hurt box to overlap them: a tall move needs a taller h, a low move a lower y." },
    ],
    shots: [
      { src: "tutorials/hitbox-before.png", caption: "Original far A at round start: the red box stops in the air" },
      { src: "tutorials/hitbox-after.png", caption: "w = 120: the same far A hits Iori across the screen (FBNeo)" },
    ],
    result: "Verified in FBNeo: Iori goes into hit ACT $100, HP $67 → $63, from the round start position.",
  },
  {
    id: "cancel",
    section: "Moves in depth",
    title: "15. Make a move cancelable (Kyo 88 Shiki, ↘+D)",
    summary: "Kyo's 88 Shiki can't be cancelled. Make it cancel into specials and supers.",
    time: "5 min",
    example: "cancel",
    steps: [
      { text: "Find the move: **Move list → Kyo** shows the command normal checked at `$19A90` → routine `$322D8` → ACT **B5**. That's 88 Shiki (↘ + D).", go: { tab: "chars" } },
      { text: "Open **Animations → Kyo → ACT 0B5**. Its two attack frames are the rows with **eff `04`** (low hit), images `7E` and `82`; both have **stun/cxl `00`** = not cancelable." },
      { text: "Set those two bytes to **`04`** (hitstun 14f, cancel into specials and supers). Use `08` for specials only or `0C` for anything. Leave the high nibble alone to keep the hitstun." },
      { text: "Write to ROM / ⚡ Try live.", check: (rs) => modifiedRange(rs, 0x213e5a, 158, actBank(rs)) },
      { text: "How to cancel in game: the kick must **touch** the opponent, and the special's motion must be finished **during the hit freeze** — the game checks the cancel byte every frame of the freeze (code at `$163EE` → `$1E5AA`)." },
    ],
    shots: [
      { src: "tutorials/cancel-before.png", caption: "Original: 88 Shiki hits, Oniyaki input ignored" },
      { src: "tutorials/cancel-after.png", caption: "Cancel 04: Oniyaki comes out of the 88 Shiki hit (FBNeo)" },
      { src: "docs/kyo-88shiki-actB5.png", caption: "ACT B5 frames: attack frames 2 and 6 (red)" },
    ],
    result: "Verified in FBNeo: with the same input the original keeps playing ACT $B5, the edited one switches to Oniyaki (routine $2FCF0, ACT $80) at frame 490.",
  },
  {
    id: "armor",
    section: "Moves in depth",
    title: "16. Give a move armor",
    summary: "Kyo takes the hit but keeps doing 88 Shiki.",
    time: "10 min",
    example: "armor",
    steps: [
      { text: "KOF97 has no armor flag in the animation. What the game does have: when an attacker's object byte **+$E6 bit 0** is set, its hits deal damage but cause **no hit reaction**." },
      { text: "So armor for P1 = a main loop hook that sets **P2's** `$1083E6` bit 0 while P1 plays the move (P1 ACT code at `$108172` = `$B5`) and clears it otherwise." },
      { text: "Open **Main loop & hooks**, keep the site `$9C44`, pick free space (e.g. `$0F0000`) and the template **Armor while an ACT plays** (ACT `B5`). Read the listing, then **Install hook** (or ⚡ Install live).", go: { tab: "hooks" }, check: (rs) => modifiedRange(rs, 0x9c44, 6) },
      { text: "For armor on certain frames only, also compare the frame index `$108180` (P1 +$80) in the hook." },
      { text: "For P2's armor swap the addresses: test `$108372`, set `$1081E6`." },
    ],
    shots: [
      { src: "tutorials/inv-before.png", caption: "Original: Iori's far C counter-hits Kyo out of 88 Shiki" },
      { src: "tutorials/armor-after.png", caption: "Armor: COUNTER and damage, but Kyo keeps going (FBNeo)" },
    ],
    result: "Verified in FBNeo: Kyo's HP drops $67 → $57 but he stays in ACT $B5 (no hit reaction $10A) and still knocks Iori down.",
  },
  {
    id: "invincible",
    section: "Moves in depth",
    title: "17. Make a move invincible",
    summary: "Remove 88 Shiki's hurt boxes so attacks pass through it.",
    time: "5 min",
    example: "invincible",
    steps: [
      { text: "Open **Animations → Kyo → ACT 0B5**. Each frame row has a **sel** byte: its low nibble picks the live box slots. Slot 0 is the attack box, slots 1-2 are hurt boxes.", go: { tab: "chars" } },
      { text: "For every frame keep only bit 0: `07` → `01`, `06` → `00`, `02` → `00`. No hurt box = nothing to hit = invincible. Keep the high nibble." },
      { text: "Only the startup? Change only the first frames. Strike-invulnerable but throwable? Add a box of type `2C` in a slot instead.", check: (rs) => modifiedRange(rs, 0x213e5a, 158, actBank(rs)) },
    ],
    shots: [
      { src: "tutorials/inv-before.png", caption: "Original: counter hit on Kyo" },
      { src: "tutorials/inv-after.png", caption: "Invincible: Iori's far C passes, 88 Shiki lands (FBNeo)" },
    ],
    result: "Verified in FBNeo: Kyo's HP stays $67 and his 88 Shiki hits Iori twice ($67 → $5B).",
  },
  {
    id: "effect",
    section: "Moves in depth",
    title: "18. Change a hit's effect (electric, blood, unblockable…)",
    summary: "Make far A hit with electricity, or make it unblockable.",
    time: "5 min",
    example: "effect",
    steps: [
      { text: "Open **Animations → Kyo → ACT 051**, frame row with image `3D` (the attack frame). Its **eff** byte is `00`.", go: { tab: "chars" } },
      { text: "High nibble = hit effect: `4` electric, `9`/`1` blood, `2` fire, `3` purple flame, `7` critical. Low nibble = guard: `0` mid, `4` low, `8` overhead, `C` unblockable, `+3` no pushback." },
      { text: "Try `40` (electric), `90` (blood) or `0C` (unblockable). The shortcut also widens the hitbox so it reaches from the round start.", check: (rs) => modifiedRange(rs, 0x21230a, 56, actBank(rs)) },
      { text: "With the emulator connected, ⚡ Try live and hit Iori: the spark changes instantly." },
    ],
    shots: [
      { src: "tutorials/hitbox-after.png", caption: "Effect 00: white spark" },
      { src: "tutorials/effect-electric.png", caption: "Effect 40: electric sparks (FBNeo)" },
      { src: "tutorials/effect-blood.png", caption: "Effect 90: blood (FBNeo)" },
    ],
    result: "Verified in FBNeo by writing the effect byte live: $40/$C0 give the electric spark, $90 the blood splash.",
  },
  {
    id: "active",
    section: "Moves in depth",
    title: "19. Extend a move's duration / active frames",
    summary: "Keep far A's punch out for 24 frames.",
    time: "5 min",
    example: "active",
    steps: [
      { text: "Open **Animations → Kyo → ACT 051**. The attack frame (image `3D`) has **dur `3`**.", go: { tab: "chars" } },
      { text: "Set dur to `24` (hex `18`): the punch and its red box stay out 24 frames. Raising startup frames makes the move slower; lowering recovery frames makes it safer." },
      { text: "Write / ⚡ Try live.", check: (rs) => modifiedRange(rs, 0x21230a, 56, actBank(rs)) },
    ],
    shots: [
      { src: "tutorials/active-before.png", caption: "Original at frame 466: back to idle" },
      { src: "tutorials/active-after.png", caption: "dur 24: still punching at frame 466 (FBNeo)" },
    ],
    result: "Verified in FBNeo: frame 2 of ACT $51 stays from frame 452 to 478.",
  },
  {
    id: "movelist",
    section: "Live",
    title: "20. Complete moves: find them and trigger them live",
    summary: "See every move as input → routine → ACTs and start any of them on the running game.",
    time: "10 min",
    steps: [
      { text: "**Characters & moves → Move list → Kyo**: each row is a complete move. Example: ↓→↓↘→ + A/C → routine `$315F8` (Mu Shiki) → ACTs D0, DB, D2, D7, DC…", go: { tab: "chars" } },
      { text: "The game decides it in code, not in a table: the command handler (`$19DAC` + char×2, Kyo `$19E3C`) tests the motion bit and the buttons, then stores the routine at object **+$198** and **+0**. Supers are tested first." },
      { text: "Connect the emulator (tutorial 21) and press **⚡ P1** on a row: P1 performs that move immediately, without input. Supers need power: use **3 power stocks** in the Live tab." },
      { text: "The Live tab's **Moves the game just executed** list shows every routine the game dispatches while you play (watch on `$101D8`)." },
    ],
    result: "Verified in FBNeo: writing $315F8 into P1 +$198/+0 started Mu Shiki (ACT $0CB → $0CD …) with no input.",
  },
  {
    id: "live",
    section: "Live",
    title: "21. Live editing: try changes without rebuilding",
    summary: "Connect FBNeo, watch the game, freeze values, see which tiles are on screen, push edits temporarily.",
    time: "10 min",
    steps: [
      { text: "Open HackROM Studio. Start KOF97 in FBNeo, then **Game → Lua Scripting → New Lua Script Window → Browse** → the `hackrom_live.lua` path shown in the Live tab → **Run**." },
      { text: "Open **Live (emulator)** and tick **enabled**. You see P1/P2: character, ACT code, frame, move routine, HP, position, and the **image and tiles on screen** with their C-ROM offsets (click one to open it).", go: { tab: "live" } },
      { text: "RAM: freeze the timer, freeze HP, write any address. Tick **draw hitboxes in the emulator** to see boxes in the game window." },
      { text: "Edit something (e.g. tutorial 14), then **⚡ Push my ROM edits live**: the running game uses it immediately. **Restore original bytes live** undoes it. Tiles and sound can't be changed live." },
      { text: "Every ⚡ button in the other tabs does the same for its own edit: Try live (Animations, Command inputs), Live patch (68k code, Hex), Install live (Hooks), Send palette (Palettes)." },
    ],
    result: "Verified with FBNeo: state, triggers, freezes, ROM writes into the ACT bank and palette RAM writes all work while the game runs.",
  },
  {
    id: "injector",
    section: "Live",
    title: "23. Make P1 or P2 do anything with the Lua injector",
    summary: "Write a short Lua program that presses motions, starts complete moves and reacts to the game, and run it in FBNeo from the Live tab.",
    time: "10 min",
    steps: [
      { text: "Connect the emulator (tutorial 21) and load the Kyo vs Iori savestate. Scroll to **Lua injector** in the Live tab.", go: { tab: "live" } },
      { text: "Pick **Examples… → P2 performs a motion** and press **▶ Run in the emulator**: Iori does `236A` (108 Shiki Yami Barai) as if a player had entered it, and the log says when he is back in neutral." },
      { text: "Use **Insert a move from the move list…** to add `move(P1, 0x2FCF0)`: Kyo's Oniyaki starts on the next frame by writing its routine into `+$198` and `+0`, without any input." },
      { text: "Try **Anti-air bot**: jump with P1 and P2 answers every jump with `623C`. **■ Stop all programs** ends it." },
      { text: "Run **Watch the state machine** and do a special: the log lists every state (`+0`) the move goes through. Open them in 68k code to see what each phase does." },
      { text: "Without the app: put your program in `my_program.lua`, in the same folder as `hackrom_live.lua`, and run `inject_demo.lua` from that folder in FBNeo." },
    ],
    shots: [{ src: "docs/live-injector.png", caption: "The KOF97 demo program run from the Live tab" }],
    result: "Verified in FBNeo (KOF97, Kyo vs Iori): motions typed by the injector start Iori's $5FC50 and $5F26E, move() starts Kyo's $2FCF0 and $315F8 from any state, and the anti-air bot reacts to P1's jump.",
    notes: ["Read **Guides & docs → Live tab & move state machine** for why this works and which memory to change for each result."],
  },
  {
    id: "build",
    section: "Build & test",
    title: "12. Build and test in FBNeo / Fightcade",
    summary: "Export your hack and play it without touching your Fightcade setup.",
    time: "5 min",
    steps: [
      { text: "Open **Build & export** and press **Download kof97.zip**. Keep the original zip!", go: { tab: "export" } },
      { text: "Don't overwrite Fightcade's `ROMs\\kof97.zip`. Use a separate FBNeo (standalone, or a copy of `Fightcade\\emulator\\fbneo` with its own `ROMs` folder) and put the hacked zip plus `neogeo.zip` there." },
      { text: "FBNeo shows a warning for modified ROMs: press **OK** and the game runs." },
      { text: "Savestates from the original game still load (they store RAM, not ROM): graphics, ACT, commands and code changes show at once; palettes from the next round." },
      { text: "Save a **project file** to keep only your changes and re-apply them to a clean set later; **IPS** patches work with other tools." },
    ],
  },
];

export function toMarkdown(list: Tutorial[], imgPrefix = ""): string {
  const out: string[] = [`# NeoGeo HackROM Studio — ${tr("Tutorials")}`, "", tr("Hands-on lessons. KOF97 examples were applied with the app and checked in FBNeo from a savestate (Kyo vs Iori)."), ""];
  for (const t of list) {
    out.push(`## ${tr(t.title)}`, "", `*${tr(t.section)} · ${tr(t.time)}* — ${tr(t.summary)}`, "");
    t.steps.forEach((s, i) => out.push(`${i + 1}. ${tr(s.text)}`));
    out.push("");
    if (t.example) out.push(`> ${tr("Shortcut: the **Apply this example for me** button makes this exact edit.")}`, "");
    if (t.shots) for (const s of t.shots) out.push(`![${tr(s.caption)}](${imgPrefix}${s.src})`, `*${tr(s.caption)}*`, "");
    if (t.result) out.push(`**${tr("Result:")}** ${tr(t.result)}`, "");
    if (t.notes) for (const n of t.notes) out.push(`> ${tr(n)}`, "");
  }
  return out.join("\n");
}

