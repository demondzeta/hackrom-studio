# NeoGeo HackROM Studio

A Windows desktop editor for Neo Geo ROM sets: tiles, palettes, KOF animations, hitboxes, command inputs, 68k code, hooks, and patched builds. Everything runs on your computer, no ROM data is uploaded anywhere, and no ROMs are included.

## Install

Download `HackROM-Studio-Setup-<version>.exe` from [Releases](https://github.com/demondzeta/hackrom-studio/releases/latest) and run it. It installs for the current user, so it needs no administrator rights, and adds a desktop and Start menu shortcut. The installer isn't code-signed yet, so Windows SmartScreen may warn the first time: choose *More info → Run anyway*.

The app checks for updates when it starts, downloads them in the background and offers **Restart to update**; otherwise the update installs when you close the app. Version and update address are on the ROM set page. Live scripts go to `Documents\HackROM Studio\live`, where `my_program.lua` and `quick.fs` survive updates.

### Publishing an update

1. Raise `version` in `package.json` and run `npm run dist`.
2. Publish the three files from `release/` as a new release of [demondzeta/hackrom-studio](https://github.com/demondzeta/hackrom-studio/releases):

   ```bash
   gh release create v<version> --repo demondzeta/hackrom-studio --title <version> --latest --notes "What changed" release/HackROM-Studio-Setup-<version>.exe release/HackROM-Studio-Setup-<version>.exe.blockmap release/latest.yml
   ```

Don't mark a release as a draft or pre-release: installed copies read `https://github.com/demondzeta/hackrom-studio/releases/latest/download`, which skips those. To use another host, put its https folder address in `hackrom.updateUrl` in `package.json`, or set it per install on the ROM set page.

## Run from source

```bash
cd app
npm install
npm run dev        # http://localhost:5178
```

`npm run desktop` runs the desktop app from source. `npm run dist` builds the Windows installer into `release/`. `npm run build` creates only the web files in `dist/`.

## Languages

The whole interface, the guides and the tutorials are available in **English, Español and Português**. Pick the language in the top bar; the choice is remembered, and the first visit follows the browser language.

- Strings are looked up by their English text (`tr("…")` in `src/i18n`), and anything not translated falls back to English.
- The translations live in `src/i18n/tr1.ts`…`tr8.ts` as `[English, Español, Português]` rows.
- `node node_modules/.keys.cjs` (built from `scripts/i18nkeys.ts`) lists every translatable string, the ones still missing, and translations that lost a `{placeholder}`, `code` span or link.
- Tutorials are exported as `docs/TUTORIALS.md`, `docs/TUTORIALS.es.md` and `docs/TUTORIALS.pt.md`.

## What it does

| Area | What you get |
|---|---|
| ROM set | Load a MAME zip or loose files. The game is detected from the header NGH. Word-swapped P ROMs are handled, P2 banks are mapped at `$200000`, and CRCs are shown. |
| Sprite tiles | Every 16×16 C-ROM tile, with its tile number and c-file offsets. Pixel editor, block copy/paste, PNG import/export, free-tile finder. |
| Fix layer | S-ROM 8×8 tiles, with an editor. |
| Palettes | Browse 16-color palettes anywhere in P ROM, edit colors (5:5:5 + dark bit), and scan for palettes. KOF97/98 character palettes are named (A/B/C/D variants). |
| Frame builder | Assemble multi-tile sprites, edit a whole frame, import a PNG frame into free tile space (optionally building a palette from it). |
| Characters & moves (KOF) | ACT scripts: frames, durations, effects, hitstun/cancel, box slots. Hit/hurt/guard boxes drawn per frame with playback. Edit and write back, with automatic relocation if a script grows; copy an ACT into a new slot. |
| Command inputs (KOF) | Scan check tables and decode or edit motions (directions, buttons, compare modes, input window, charge), and repoint slots. |
| Move routines (KOF) | Lists every `move.l #routine,($198,An)`. Cloning a routine turns it into relocatable assembly (branches and next-frame pointers become labels). You can edit it, assemble it into free P1 space, and repoint the command to it. A template for new moves is included. |
| 68k code | Disassembler with labels, navigation, cross-references, and bookmarks. Patch an instruction with the built-in assembler (shorter code is NOP-padded). |
| Main loop & hooks | Header entries and vectors, plus ranked main-loop candidates (KOF97 loop at `$9C38`/`$9C44` is known). The detour builder checks instruction boundaries and PC-relative code, re-runs the displaced instructions, and jumps back. Templates: timer freeze, infinite health, show boxes, button combo → move. |
| Hex editor | Any file, with typing over bytes and wildcard pattern search. |
| Build & export | Patched zip with original names and byte order, IPS per file, project JSON (only your changes plus bookmarks), and an edit history. Undo/redo works everywhere. |
| Live (emulator) | Link to a running FBNeo through `tools/live/hackrom_live.lua`. Shows P1/P2 state, the image and **tiles on screen with their C-ROM offsets**, and the moves the game dispatches. Lets you watch, write and freeze RAM, **trigger any complete move**, draw hitboxes in the emulator, and push ROM edits temporarily. Every editor has a ⚡ live button. |
| Move list | Each character's complete moves: input → command handler ($19DAC table) → move routine → ACTs played → damage, with live trigger buttons. |
| Tutorials | 22 hands-on lessons covering every tool, with "Go there" buttons, automatic step checks, an "Apply this example for me" button for KOF97, and before/after screenshots captured in FBNeo. Also in `docs/TUTORIALS.md`. |
| Guides & docs | Reference: cartridge layout, the ACT format, a new-move workflow, the full-character checklist, hooks, and testing. |

Use **Try the synthetic demo set** on the start page to explore every tool without a ROM. It is generated data laid out like KOF97, with no game content.

## Verified on real KOF97 (FBNeo, from a Kyo vs Iori savestate)

- Banks 0001/0002, the ACT tables (all 512 Kyo ACTs parse; no unknown commands across 32 characters), and the graph and image tables (`$250000` + char×4).
- Sprite definitions: `mode, cols, rows, first tile` plus one row-mask byte per column. Kyo's frames render correctly.
- 55 command tables. Kyo's are at `$A6E38`, and slot 5 at `$A7CD2` is Oniyaki.
- Move routines: Oniyaki is `$2FCF0` (set at `$19F1A`); Red Kick is `$2FEDA`.
- Main loop `$9C38`, with the hook site at `$9C44`. Timer `$10A83A`. P1/P2 objects at `$108100`/`$108300`.
- Palettes start at the listed offset − 2. The game copies them to palette RAM (Kyo P1 = `$010`) at round start, so a palette edit shows from the next round.
- Fix font is at tile `$300`, and the CREDITS text at `$3E0`.
- Sprite definition types (all KOF97 images): 0/1 are consecutive tiles with word/byte row masks; 3, 7 and 8 are 16-bit tile lists; 9/A are 8-bit tile lists; 6 is an empty frame. Types 2 and 5 (36 images) are not decoded yet.
- Moves: the per-character command handler is at `$19DAC` + char×2 (word offset), and the check tables are at `$A6C00` + char×16 (13 slots). A move routine is stored at object +$198 and +0; writing both fields triggers the move.
- Cancels are processed during the hit freeze (`$163EE` → `$1E5AA`), using the cancel nibble of the frame that hit. Armor comes from setting bit 0 of the attacker's +$E6 (no hit reaction). Invincibility means no hurt slot is selected. All three were checked with Kyo's 88 Shiki (ACT $B5).
- All seven tutorial edits work together in one ROM (`tools/fbneo-test`).

## Live link

1. Start the app with `npm run dev` (it also serves the bridge at `/__live`).
2. Start the game in FBNeo, then use Game → Lua Scripting → New Lua Script Window → Browse → `tools/live/hackrom_live.lua` → Run.
3. Open the **Live (emulator)** tab and tick *enabled*.

The script and the app exchange two small files in `%TEMP%` (`hackrom_live_cmd.txt`, `hackrom_live_state.txt`). Changes are temporary: resetting the game removes them.

### Lua move injector

`tools/live/injector.lua` runs small Lua programs inside FBNeo, one step per frame, to make P1 or P2 do anything:

```lua
motion(P2, "236A")      -- type a motion (numpad notation, relative to facing)
waitNeutral(P2)
move(P1, 0x2FCF0)       -- start a complete move routine (KOF97 Kyo's Oniyaki) from any state
press(P2, "6", 20)      -- hold forward for 20 frames
```

- **From the app:** Live tab → *Lua injector* (examples, the move list as `move(...)` lines, a log).
- **Without the app:** put a program in `tools/live/my_program.lua` and run `tools/live/inject_demo.lua` in FBNeo.
- **How it works:** Guides & docs → *Live tab & move state machine*. It covers the object state at `+0`, the dispatcher, move routine phases, which memory to change for which result, and frame-by-frame images recorded in FBNeo. `scripts/statedocs.ts` rebuilds those images from a KOF97 set and `scripts/data/kof97_kyo_oniyaki_trace.txt`.

## How reliable each part is

- **Works for any game:** the Neo Geo formats (C/S tiles, palette words, header, banks), the 68000 disassembler and assembler (round-trip tested), hooks, hex editing, and export.
- **KOF97, from the notes in `base info`:** ACT table locations (`$200002` in banks 0001/0002), the 6-byte ACT command format, box types, hitstun/cancel tables, the command-definition format, the `$198` routine pointer, the main loop, RAM addresses, and palette offsets.
- **Experimental:** the KOF98 profile (it uses the KOF97 layout and is not verified yet) and the "button combo → move" hook template. Verify these in MAME (`mame kof97 -debug`).

## Tests

```bash
npm test                                   # assembler/disassembler round trip, palette and tile codecs
npx esbuild scripts/makeFakeKof.ts --bundle --platform=node --outfile=node_modules/.mk.cjs && node node_modules/.mk.cjs demo.zip
npx esbuild scripts/verifyFake.ts --bundle --platform=node --outfile=node_modules/.vf.cjs && node node_modules/.vf.cjs demo.zip
npx esbuild scripts/inspect.ts --bundle --platform=node --outfile=node_modules/.in.cjs && node node_modules/.in.cjs path/to/game.zip
```

## Notes

- Sets from KOF99 onward have encrypted C ROMs (CMC) and sometimes an encrypted P1, so use decrypted dumps. The MVS `kof98` P1 is protected; `kof98n`/`kof98h`-style unencrypted P1 files work.
- MAME reports wrong checksums for edited files but still runs the set.
