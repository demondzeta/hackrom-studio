// Live link to a running FBNeo (tools/live/hackrom_live.lua) through the dev server bridge (/__live).
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RomSet } from "../core/romset";
import { tr } from "../i18n";

export interface LiveBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LivePlayer {
  ch: number;
  act: number;
  routine: number;
  next: number;
  x: number;
  y: number;
  hp: number;
  power: number;
  facing: number;
  status: number;
  graph: number;
  frameIdx: number;
  boxes: LiveBox[]; // slots 0-3 + push box
}

export interface LiveState {
  frame: number;
  rom: string;
  bank: number;
  timer: number;
  p1: LivePlayer | null;
  p2: LivePlayer | null;
  dispatch: { frame: number; obj: number; routine: number; act: number }[];
  freezes: { size: number; addr: number; value: number }[];
  watches: Record<number, Uint8Array>;
  err: string;
  pending: number;
  dispatchHook: boolean;
  /** injector programs running (-1 = injector.lua missing) */
  lua: number;
  /** injector log, newest last */
  luaOut: string[];
}

const s8 = (v: number) => (v >= 0x80 ? v - 0x100 : v);

function parsePlayer(v: string | undefined): LivePlayer | null {
  if (!v) return null;
  const p = v.split(",");
  if (p.length < 13) return null;
  const hx = (i: number) => parseInt(p[i], 16);
  const boxes: LiveBox[] = [];
  const raw = p[12];
  for (let i = 0; i < 5; i++) {
    const b = (k: number) => parseInt(raw.substr((i * 5 + k) * 2, 2), 16);
    boxes.push({ id: b(0), x: s8(b(1)), y: s8(b(2)), w: b(3), h: b(4) });
  }
  return {
    ch: hx(0),
    act: hx(1),
    routine: hx(2),
    next: hx(3),
    x: parseInt(p[4], 10),
    y: parseInt(p[5], 10),
    hp: hx(6),
    power: hx(7),
    facing: hx(8),
    status: hx(9),
    graph: hx(10),
    frameIdx: parseInt(p[11], 10),
    boxes,
  };
}

export function parseState(text: string): LiveState {
  const kv: Record<string, string> = {};
  const watches: Record<number, Uint8Array> = {};
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1);
    if (/^w[0-9A-F]{6}$/.test(k)) {
      const b = new Uint8Array(v.length / 2);
      for (let j = 0; j < b.length; j++) b[j] = parseInt(v.substr(j * 2, 2), 16);
      watches[parseInt(k.slice(1), 16)] = b;
    } else kv[k] = v;
  }
  return {
    frame: +(kv.frame ?? 0),
    rom: kv.rom ?? "",
    bank: parseInt(kv.bank ?? "0", 16),
    timer: parseInt(kv.timer ?? "0", 16),
    p1: parsePlayer(kv.p1),
    p2: parsePlayer(kv.p2),
    dispatch: (kv.dispatch ?? "")
      .split(";")
      .filter(Boolean)
      .map((d) => {
        const [f, o, r, a] = d.split(",");
        return { frame: +f, obj: parseInt(o, 16), routine: parseInt(r, 16), act: parseInt(a, 16) };
      }),
    freezes: (kv.freezes ?? "")
      .split(";")
      .filter(Boolean)
      .map((f) => {
        const [s, a, v] = f.split(":");
        return { size: +s, addr: parseInt(a, 16), value: parseInt(v, 16) };
      }),
    watches,
    err: kv.err ?? "",
    pending: +(kv.pending ?? 0),
    dispatchHook: kv.dispatchHook === "1",
    lua: kv.lua === undefined ? -1 : +kv.lua,
    luaOut: (kv.luaout ?? "").split("\t").filter(Boolean),
  };
}

interface LiveCtx {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  connected: boolean;
  bridge: boolean;
  dir: string;
  state: LiveState | null;
  send: (cmds: string[]) => Promise<boolean>;
}

const Ctx = createContext<LiveCtx | null>(null);
export const useLive = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("no live ctx");
  return c;
};

const KEY = "nghs.liveEnabled";

export function LiveProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [state, setState] = useState<LiveState | null>(null);
  const [connected, setConnected] = useState(false);
  const [bridge, setBridge] = useState(false);
  const [dir, setDir] = useState("");
  const busy = useRef(false);

  const setEnabled = (v: boolean) => {
    setEnabledState(v);
    try {
      localStorage.setItem(KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }
    const id = setInterval(async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const r = await fetch("/__live/state", { cache: "no-store" });
        const j = await r.json();
        setBridge(true);
        setDir(j.script ?? "");
        if (j.ok && j.ageMs < 1500) {
          setState(parseState(j.text));
          setConnected(true);
        } else setConnected(false);
      } catch {
        setBridge(false);
        setConnected(false);
      } finally {
        busy.current = false;
      }
    }, 120);
    return () => clearInterval(id);
  }, [enabled]);

  const send = useCallback(async (cmds: string[]) => {
    try {
      const r = await fetch("/__live/cmd", { method: "POST", body: cmds.join("\n") });
      return r.ok;
    } catch {
      return false;
    }
  }, []);

  return <Ctx.Provider value={{ enabled, setEnabled, connected, bridge, dir, state, send }}>{children}</Ctx.Provider>;
}

const hex = (n: number, w = 0) => n.toString(16).toUpperCase().padStart(w, "0");

/** Commands that write bytes at a 68k address of the loaded ROM (banked areas wait for their bank). */
export function writeCmds(rs: RomSet, addr: number, bytes: ArrayLike<number>, bank = 0): string[] {
  const out: string[] = [];
  const bankId = addr >= 0x200000 && addr < 0x300000 ? rs.read16(0x200000, bank) : -1;
  for (let i = 0; i < bytes.length; i += 48) {
    const chunk = Array.from(bytes).slice(i, i + 48).map((b) => hex(b, 2)).join("");
    out.push(bankId >= 0 ? `wbb ${hex(bankId, 4)} ${hex(addr + i, 6)} ${chunk}` : `wb ${hex(addr + i, 6)} ${chunk}`);
  }
  return out;
}

/** All program-ROM edits (current vs original) as live write commands; `revert` sends the original bytes. */
export function romDiffCmds(rs: RomSet, revert = false): { cmds: string[]; bytes: number; skipped: string[] } {
  const cmds: string[] = [];
  const skipped: string[] = [];
  let bytes = 0;
  rs.files.forEach((f, i) => {
    const regions = rs.diff(i);
    if (!regions.length) return;
    if (f.role !== "p") {
      skipped.push(tr("{name} ({n} regions): graphics/sound ROMs can't be changed in a running game", { name: f.name, n: regions.length }));
      return;
    }
    for (const r of regions) {
      const loc = rs.fileToCpu(i, r.offset);
      if (!loc) continue;
      const src = revert ? f.orig : f.data;
      cmds.push(...writeCmds(rs, loc.addr, src.subarray(r.offset, r.offset + r.length), Math.max(0, loc.bank)));
      bytes += r.length;
    }
  });
  return { cmds, bytes, skipped };
}

/** Button that sends commands to the running game; disabled when the emulator is not connected. */
export function LiveButton({ label, cmds, title, onSent, small = true }: { label: string; cmds: () => string[] | null; title?: string; onSent?: (n: number) => void; small?: boolean }) {
  const { connected, send } = useLive();
  return (
    <button
      className={"btn live" + (small ? " sm" : "")}
      disabled={!connected}
      title={connected ? title ?? tr("Apply to the running game now (temporary)") : tr("Connect the emulator in the Live tab first")}
      onClick={async () => {
        const c = cmds();
        if (!c || !c.length) return;
        await send(c);
        onSent?.(c.length);
      }}
    >
      ⚡ {label}
    </button>
  );
}
