// Game profiles: what is known about specific games. Everything else in the app works generically.
import type { RomSet } from "../core/romset";

export interface RamLabel {
  addr: number;
  name: string;
  desc: string;
}

export interface KofLayout {
  /** bank id (first word of the bank) holding sprite/graph tables */
  graphBankId: number;
  /** bank id holding image tables and sprite definitions, when it differs from graphBankId (KOF2002) */
  imageBankId?: number;
  /** bank id holding ACT (animation script) tables */
  actBankId: number;
  /** pointer table (one long per character) at this CPU address in both banks */
  charTable: number;
  /** number of character entries in the ACT table (incl. effects/bg/portrait slots) */
  charCount: number;
  /** ACT slots per character (table stride / 4) */
  actsPerChar: number;
  /** P1 table: character -> pointer to P1 ACT -> P2 ACT mapping words */
  p1ActMap?: number;
  /** P1 range that holds command (input motion) definitions */
  commandArea?: [number, number];
  /** per character 16 bytes: [left table, right table, left, right] (checked on KOF97: $A6C00) */
  commandPtrTable?: number;
  /** word-offset table (relative to itself) of each character's command handler (KOF97: $19DAC) */
  handlerTable?: number;
  /** graph bank: table of per-character image-table pointers (long per character) */
  imagePtrTable?: number;
  /** known image table bases for some characters (CPU address in the graph bank) */
  imageTables?: Record<number, number>;
  /** offset of the "next routine" pointer in the player object (move routine dispatch) */
  routineField: number;
  playerObjects: { name: string; addr: number }[];
}

export interface GameProfile {
  id: string;
  name: string;
  ngh: number[];
  status: "documented" | "experimental";
  notes: string[];
  characters: string[];
  mainLoop?: { entry: number; loopPoints: number[]; note: string };
  ram: RamLabel[];
  codeLabels: Record<number, string>;
  kof?: KofLayout;
  /** key for KOF_PALETTES */
  paletteSet?: string;
  hitboxTypes?: Record<number, { name: string; color: string; group: "hurt" | "attack" | "guard" | "throw" | "projectile" | "other"; tm?: TmBoxKind }>;
}

const KOF97_CHARS = [
  "Kyo", "Benimaru", "Daimon", "Terry", "Andy", "Joe", "Ryo", "Robert", "Yuri", "Leona", "Ralf", "Clark",
  "Athena", "Kensou", "Chin", "Chizuru", "Mai", "King", "Kim", "Chang", "Choi", "Yashiro", "Shermie", "Chris",
  "Yamazaki", "Mary", "Billy", "Iori", "Orochi Iori", "Orochi Leona", "Orochi", "Shingo",
  "(effects)", "(background)", "(portraits)",
];

/** Box colors used by Fightcade's FBNeo training mode (hitboxes/kof-hitboxes.lua). */
export const TM_BOX_COLORS = {
  vulnerability: "#7777FF",
  attack: "#FF0000",
  "proj. vulnerability": "#00FFFF",
  "proj. attack": "#FF66FF",
  push: "#00FF00",
  guard: "#CCCCFF",
  throw: "#FFFF00",
  throwable: "#F0F0F0",
} as const;
export type TmBoxKind = keyof typeof TM_BOX_COLORS;

/**
 * Training-mode category of a box. In RAM the box id is the ACT type >> 2 (checked in FBNeo) and
 * kof-hitboxes.lua maps it for KOF96-2002: 1-9 vulnerability, 10-11 guard, 12-55 attack, 56-57 guard, 58-63 projectile vulnerability.
 */
export function tmBoxKind(type: number, projectile = false): TmBoxKind {
  const id = (type & 0xff) >> 2;
  if (id <= 9) return "vulnerability";
  if (id <= 11) return "guard";
  if (id <= 55) return projectile ? "proj. attack" : "attack";
  if (id <= 57) return "guard";
  return "proj. vulnerability";
}

// Judgment (box) types, from the KOF97 P2 tutorial appendix. Base type = value & 0xFC; low 2 bits = box slot.
export const KOF97_BOX_TYPES: GameProfile["hitboxTypes"] = (() => {
  const t: NonNullable<GameProfile["hitboxTypes"]> = {};
  const set = (v: number, name: string, color: string, group: "hurt" | "attack" | "guard" | "throw" | "projectile" | "other") => (t[v] = { name, color, group });
  set(0x00, "Hurt: counter-able", "#2d5bd6", "hurt");
  set(0x04, "Hurt: head", "#26c64b", "hurt");
  set(0x08, "Hurt: body", "#e3d12a", "hurt");
  set(0x0c, "Hurt: counter (high)", "#2d5bd6", "hurt");
  set(0x10, "Hurt: counter (low)", "#9a9a9a", "hurt");
  set(0x14, "Hurt: MAX counter", "#9a9a9a", "hurt");
  set(0x18, "Hurt: MAX counter", "#e03030", "hurt");
  set(0x1c, "Hurt: counter variant", "#2d5bd6", "hurt");
  set(0x20, "Hurt: counter variant", "#2d5bd6", "hurt");
  set(0x24, "Hurt: counter variant", "#2d5bd6", "hurt");
  set(0x28, "Guard box", "#e03030", "guard");
  set(0x2c, "Strike invulnerable", "#ff6b6b", "guard");
  set(0x30, "Attack: light normal", "#ffffff", "attack");
  set(0x34, "Attack: heavy normal", "#ffffff", "attack");
  set(0x38, "Attack: close low knockdown", "#ffffff", "attack");
  set(0x3c, "Attack: launch self-rise", "#ffffff", "attack");
  const sp: [number, string][] = [
    [0x40, "ground heavy / air far low KD"], [0x44, "far low KD (CD)"], [0x48, "air far low KD, short juggle"], [0x4c, "air close high KD, short juggle"],
    [0x50, "air close Down"], [0x54, "close Down"], [0x58, "far Down"], [0x5c, "guard crush pose"],
    [0x60, "special: far low KD (projectiles)"], [0x64, "special: short juggle"], [0x68, "special: long juggle"], [0x6c, "far low KD"],
    [0x70, "far low KD, short juggle"], [0x74, "far low KD, long juggle"], [0x78, "air far low KD"], [0x7c, "air far low KD, short juggle"],
    [0x80, "air far low KD, long juggle"], [0x84, "far low KD"], [0x88, "far low KD short juggle"], [0x8c, "far low KD long juggle"],
    [0x90, "air close high KD"], [0x94, "air close high KD, short"], [0x98, "air close high KD, long"], [0x9c, "close high KD"],
    [0xa0, "close high KD, short juggle"], [0xa4, "close high KD, long juggle"], [0xa8, "air far low KD, very short"], [0xac, "far low KD very short"],
    [0xb0, "in-place high KD long juggle"], [0xb4, "spinning high far KD"], [0xb8, "inverted spin close high KD"], [0xbc, "inverted spin, long juggle"],
    [0xc0, "air close Down"], [0xc4, "close Down"], [0xc8, "far Down"], [0xcc, "self-rise launch"], [0xd0, "air far Down"],
    [0xd4, "long hitstun"], [0xd8, "ranbu-type only"], [0xdc, "ranbu-type only"],
  ];
  for (const [v, n] of sp) set(v, "Attack: " + n, v < 0x60 ? "#7fd3ff" : "#ff9f1c", "attack");
  set(0xe0, "Counter-type (anti air/special)", "#2d5bd6", "other");
  set(0xe4, "Counter-type (ground)", "#2d5bd6", "other");
  set(0xe8, "Projectile Lv1", "#ff8c00", "projectile");
  set(0xec, "Projectile Lv2 (super)", "#ff8c00", "projectile");
  set(0xf0, "Projectile Lv3 (MAX)", "#ff8c00", "projectile");
  set(0xf4, "Projectile Lv4", "#ff8c00", "projectile");
  set(0xf8, "Projectile Lv1 (?)", "#ff8c00", "projectile");
  set(0xfc, "Projectile reflector", "#ff8c00", "projectile");
  // colors follow the training mode categories
  for (const key of Object.keys(t)) {
    const v = +key;
    const kind = tmBoxKind(v);
    t[v].color = TM_BOX_COLORS[kind];
    t[v].tm = kind;
  }
  return t;
})();

const KOF_COMMON_RAM: RamLabel[] = [
  { addr: 0x100000, name: "Debug DIPs", desc: "KOF97 debug dips (checked in FBNeo): $02 object markers, $04 player info, $08 input bits, $80 debug menus (SEQ TOOL)" },
  { addr: 0x108100, name: "P1 object", desc: "Player 1 object (A4). +0 = next routine pointer, +$70 char id, +$72 ACT, +$198 move routine" },
  { addr: 0x108170, name: "P1 char id", desc: "word" },
  { addr: 0x108172, name: "P1 ACT", desc: "current animation (ACT) number" },
  { addr: 0x108239, name: "P1 health", desc: "byte, $66 = full (offset +$139)" },
  { addr: 0x1082e3, name: "P1 power stocks", desc: "byte (offset +$1E3)" },
  { addr: 0x108298, name: "P1 move routine", desc: "long: current move routine address (+$198)" },
  { addr: 0x108300, name: "P2 object", desc: "Player 2 object" },
  { addr: 0x108372, name: "P2 ACT", desc: "" },
  { addr: 0x108439, name: "P2 health", desc: "" },
  { addr: 0x108498, name: "P2 move routine", desc: "" },
  { addr: 0x10a83a, name: "Round timer", desc: "byte (KOF97/98)" },
  { addr: 0x10a7f1, name: "Stage / round", desc: "" },
  { addr: 0x10da44, name: "P1 input + 2 frames", desc: "input history used by the command parser" },
  { addr: 0x10da48, name: "P1 command check result", desc: "bitfield of recognised motions" },
  { addr: 0x10e79c, name: "Command queue", desc: "input buffer feeding the command parser" },
  { addr: 0x10fd96, name: "BIOS_P1CURRENT", desc: "BIOS: player 1 current input (bit0 up,1 down,2 left,3 right,4 A,5 B,6 C,7 D)" },
  { addr: 0x10fd97, name: "BIOS_P1CHANGE", desc: "BIOS: player 1 newly pressed" },
  { addr: 0x10fd9c, name: "BIOS_P2CURRENT", desc: "BIOS: player 2 current input" },
  { addr: 0x10fdac, name: "BIOS_STATCURRENT", desc: "Start/select state" },
];

const KOF97_CODE: Record<number, string> = {
  0x9c38: "MainLoop_Entry",
  0x9c44: "MainLoop",
  0x9c50: "MainLoop_2",
  0x9ea2: "IRQ_Handler",
  0x9f68: "UpdateP1P2KeyState",
  0x12914: "CommandCheck",
  0x30b2: "AllocObject",
  0x3126: "FreeObject",
  0x584c: "AnimStep",
  0x58aa: "AnimInterpreter",
  0x3698: "BoxCheckLoop",
  0x9e04: "BoxCheck",
  0x9e0a: "CheckP1P2BodyOverlap",
  0x140fe: "SetDamage",
  0x18c1c: "ApplyDamage",
  0x1e2fa: "SpecialMoveStart",
  0x1e374: "SpawnChildObject",
  0x1ead8: "EndMove_Standing",
  0x1eb20: "EndMove_Crouching",
  0x2516a: "ReturnToNeutral",
  0x248a8: "SpecialStart_A",
  0x24926: "SpecialStart_B",
  0x155f4: "AddPower",
  0x7a98: "LoadSfx",
  0x7700: "PlaySound",
  0x3f8a: "CanBeThrown",
  0x1efa6: "MarkAsSpecial",
  0x98180: "CheckFollowupInput",
  0x101d8: "DispatchMoveRoutine",
  0x10f02: "PowerGainSub",
  0x2fcf0: "Kyo_Oniyaki",
  0x2feda: "Kyo_RedKick",
  0x2fbda: "Kyo_MoveWait",
};

/** KOF98 labels found by matching the KOF97 code (same routines, moved). */
const KOF98_CODE: Record<number, string> = {
  0x9c14: "USER",
  0x16a66: "LoadCommandTables",
  0x1e6c2: "SetCommandHandler",
  0x5dac: "LoadCharTables",
  0x14854: "DispatchMoveRoutine",
  0xa12a: "MainLoop_Entry",
  0xa136: "MainLoop",
  0xa142: "MainLoop_2",
  0xa4a0: "UpdateP1P2KeyState",
};

export const PROFILES: GameProfile[] = [
  {
    id: "kof97",
    name: "The King of Fighters '97",
    ngh: [0x0232],
    status: "documented",
    notes: [
      "P1 = 1MB fixed program, P2 (232-p2.sp2) = 4MB in four 1MB banks switched at $2FFFF0.",
      "Bank tagged 0001 holds the graph tables (frame offsets + images, image tables at $250000); bank 0002 holds ACT scripts (animations, boxes).",
      "Sprite definitions: mode.w, cols.b, rows.b, first tile.l, then one row-mask byte per column (bit 7 = top).",
      "Character palettes: 16 colors at the listed P2 offset - 2 (the notes skip the transparent color 0).",
      "Main loop at $9C38 (loop points $9C44/$9C50). Input read at $9F68, motion check at $12914.",
      "Player objects: P1 $108100, P2 $108300. Move routine pointer at +$198, next routine at +0.",
      "Not encrypted: graphics, sound and program can be edited directly.",
      "Verified in FBNeo: Kyo's Oniyaki routine is $2FCF0 (set at $19F1A), Red Kick $2FEDA (set at $19EC4).",
      "Fix layer: ASCII-like font from tile $300, the CREDITS text at $3E0.",
      "Palettes are copied to palette RAM when a round starts (Kyo P1 = palette $010): ROM palette edits show from the next round / character load.",
    ],
    characters: KOF97_CHARS,
    mainLoop: { entry: 0x9c38, loopPoints: [0x9c44], note: "From the KOF97 notes, checked on the real ROM: $9C44 clears the VBlank flag, $9C50 waits for it, $9C5C reads inputs. Hook at $9C44 (6 relocatable bytes)." },
    ram: KOF_COMMON_RAM,
    codeLabels: KOF97_CODE,
    kof: {
      graphBankId: 1,
      actBankId: 2,
      charTable: 0x200002,
      charCount: 35,
      actsPerChar: 0x200,
      p1ActMap: 0xafbca,
      commandArea: [0xa6000, 0xa9000],
      commandPtrTable: 0xa6c00,
      handlerTable: 0x19dac,
      imagePtrTable: 0x250000,
      imageTables: { 0: 0x2536c6 },
      routineField: 0x198,
      playerObjects: [
        { name: "P1", addr: 0x108100 },
        { name: "P2", addr: 0x108300 },
      ],
    },
    paletteSet: "kof97",
    hitboxTypes: KOF97_BOX_TYPES,
  },
  {
    id: "kof98",
    name: "The King of Fighters '98",
    ngh: [0x0242],
    status: "experimental",
    notes: [
      "The MVS kof98 P1 (242-p1.p1, 2MB) is encrypted: the app decrypts it on load (same word shuffle FBNeo/MAME use) and encrypts it again on export, so edited sets still run in FBNeo. Unencrypted 1MB P1s (kof98h / kof98n) load as they are.",
      "Same engine as KOF97 with moved tables, found by matching the KOF97 code that uses them: ACT tables $200002 (bank 0002), graph tables $200002 and image tables $240000 (bank 0001), P1 ACT map $B9536, command pointers $B14A2, command handlers $1EF56.",
      "Character ids follow the name list in P1 ($B40A8): Kyo = 00 … Shingo = 25, then effects, background and portraits.",
      "Main loop $A12A (hook at $A136), move dispatcher $14854. Player objects and RAM are the same as KOF97 (P1 $108100, P2 $108300, ACT +$72, health +$139, routine +$198, timer $10A83A).",
      "Verified in FBNeo from a Kyo vs Iori savestate: the move list routines match the ones the game dispatches, writing $3C078 into P1 +$198/+0 starts that move, and an exported set with a hook still loads.",
      "Character palettes from the KOF98 palette notes (P2 offsets).",
    ],
    characters: [
      "Kyo", "Benimaru", "Daimon", "Terry", "Andy", "Joe", "Ryo", "Robert", "Yuri", "Leona", "Ralf", "Clark",
      "Athena", "Kensou", "Chin", "Chizuru", "Mai", "King", "Kim", "Chang", "Choi", "Yashiro", "Shermie", "Chris",
      "Yamazaki", "Mary", "Billy", "Iori", "Mature", "Vice", "Heidern", "Takuma", "Saisyu", "Heavy D!", "Lucky", "Brian",
      "Rugal", "Shingo", "(effects)", "(background)", "(portraits)",
    ],
    mainLoop: { entry: 0xa12a, loopPoints: [0xa136], note: "Same loop as KOF97, moved: $A136 clears the VBlank flag, $A142 waits for it, $A14E reads inputs. Hook at $A136 (6 relocatable bytes). Checked in FBNeo: a timer-freeze hook here keeps the timer at 60." },
    ram: KOF_COMMON_RAM,
    codeLabels: KOF98_CODE,
    kof: {
      graphBankId: 1,
      actBankId: 2,
      charTable: 0x200002,
      charCount: 41,
      actsPerChar: 0x200,
      p1ActMap: 0xb9536,
      commandArea: [0xb1000, 0xb4000],
      commandPtrTable: 0xb14a2,
      handlerTable: 0x1ef56,
      imagePtrTable: 0x240000,
      routineField: 0x198,
      playerObjects: [
        { name: "P1", addr: 0x108100 },
        { name: "P2", addr: 0x108300 },
      ],
    },
    paletteSet: "kof98",
    hitboxTypes: KOF97_BOX_TYPES,
  },
  {
    id: "kof2002",
    name: "The King of Fighters 2002",
    ngh: [0x0265],
    status: "experimental",
    notes: [
      "The 4MB P2 is stored as eight 512KB blocks out of order (both kof2002 and the kof2002b bootleg): the app puts them in order on load and back on export, so the bank tags read 0000-0003 as in KOF97/98.",
      "Graphics: the original kof2002 C ROMs are CMC50 encrypted and are not decoded yet, so tiles and sprite previews only work with kof2002b, whose bootleg C ROMs only shuffle tiles inside groups of 512 (undone on load, redone on export).",
      "Three banks are used for sprites: frame list (frame id → x/y + image) in bank 0003 at $200002, image tables and sprite definitions in bank 0001 at $200002, ACT scripts in bank 0002 at $200002.",
      "Tables found by matching the KOF98 code: command pointers $C11CE (44 characters), command handlers $21894, P1 ACT map $C4D6C, move dispatcher $2ECF0, main loop $8FFC (hook at $9008).",
      "Verified in FBNeo from a savestate: P1 (#00 Kyo) ↓↘→+A dispatches $374A6 as decoded, writing $36EE6 into P1 +$198/+0 starts his Oniyaki (ACTs 81, 83, 85). Player objects, ACT and health (+$139, full = $66) are where KOF97/98 have them; the round timer is not at $10A83A.",
      "Character names are only filled in where they were checked (#00 Kyo, #06 Kim, #15 Iori); the others show their id.",
    ],
    characters: Array.from({ length: 46 }, (_, i) => ({ 0x00: "Kyo", 0x06: "Kim", 0x15: "Iori" } as Record<number, string>)[i] ?? `#${i.toString(16).toUpperCase().padStart(2, "0")}`),
    mainLoop: { entry: 0x8ffc, loopPoints: [0x9008], note: "Same loop as KOF97/98, moved: $9008 starts the frame, $9012 waits for VBlank, $901E reads inputs. Hook at $9008 (andi.b #$7F,($2789,a5), 6 relocatable bytes)." },
    ram: KOF_COMMON_RAM.filter((r) => r.name !== "Round timer"),
    codeLabels: { 0x8ffc: "MainLoop_Entry", 0x9008: "MainLoop", 0x9012: "MainLoop_2", 0x937c: "UpdateP1P2KeyState", 0x2ecf0: "DispatchMoveRoutine", 0x20b52: "SetCommandHandler", 0x64be: "LoadGraphEntry", 0x65f4: "LoadCharTables" },
    kof: {
      graphBankId: 3,
      imageBankId: 1,
      actBankId: 2,
      charTable: 0x200002,
      charCount: 46,
      actsPerChar: 0x200,
      p1ActMap: 0xc4d6c,
      commandArea: [0xc1000, 0xc4000],
      commandPtrTable: 0xc11ce,
      handlerTable: 0x21894,
      imagePtrTable: 0x200002,
      routineField: 0x198,
      playerObjects: [
        { name: "P1", addr: 0x108100 },
        { name: "P2", addr: 0x108300 },
      ],
    },
    hitboxTypes: KOF97_BOX_TYPES,
  },
];

export const GENERIC_PROFILE: GameProfile = {
  id: "generic",
  name: "Generic Neo Geo",
  ngh: [],
  status: "experimental",
  notes: ["No game specific data. Tiles, palettes, code, hooks, hex editing and export all work for any unencrypted set."],
  characters: [],
  ram: KOF_COMMON_RAM.filter((r) => r.name.startsWith("BIOS")),
  codeLabels: {},
};

export function detectProfile(rs: RomSet): GameProfile {
  const ngh = rs.read16(0x108);
  const byNgh = PROFILES.find((p) => p.ngh.includes(ngh));
  if (byNgh) return byNgh;
  const n = rs.setName.toLowerCase();
  return PROFILES.find((p) => n.startsWith(p.id)) ?? GENERIC_PROFILE;
}
