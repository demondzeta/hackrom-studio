# FBNeo test harness

The scripts used to check the tutorial examples on real KOF97 in FBNeo. They drive a **separate copy** of Fightcade's FBNeo, so your Fightcade install, ROMs and settings are never touched.

## Set up a test copy (once)

1. Make a folder, for example `C:\fbneo-test`.
2. Copy into it from `Fightcade\emulator\fbneo\`: `fcadefbneo.exe`, all `*.dll`, and the `config`, `support` and `ui` folders.
3. Create empty `ROMs`, `savestates`, `fightcade`, `avi`, `recordings` and `neocdiso` folders.
4. In `config\fcadefbneo.ini` set `szAppRomPaths[0] ROMs/` and `bAutoPause 0`.
5. Put `neogeo.zip` in `ROMs\`. Put your savestate (for example `kof_97_apptest.fs`) in `savestates\`.
6. Copy the files from this folder next to `fcadefbneo.exe`, and make a `sets\` folder for the patched zips.

## Run an example

```powershell
node ..\..\node_modules\.ex.mjs "path\to\clean\kof97.zip" palette sets\palette.zip   # build a patched set (see scripts/fbneoExamples.ts)
.\runex.ps1 -Ex palette -Cfg 'return { state = "savestates/kof_97_apptest.fs", out = "palette", frames = 482, shots = {480} }'
```

`harness.lua` loads the savestate, applies the scripted `inputs`/`poke` from the config, logs P1/P2 character, ACT, HP and the timer, and saves PNG screenshots (`<out>_f<frame>.png`). `boxes = true` draws hit and hurt boxes from object RAM (+$90/$95/$9A/$9F). `runtest.ps1` clicks OK on FBNeo's "modified ROM" warning and closes the emulator once the run finishes.
