import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEBUG_PALETTE } from "./core/gfx";
import type { RomSet } from "./core/romset";
import { detectProfile, GameProfile, GENERIC_PROFILE } from "./games/profiles";

export type Tab = "home" | "tutorials" | "live" | "tiles" | "fix" | "palettes" | "sprites" | "chars" | "code" | "hooks" | "hex" | "export" | "guide";

export interface Bookmark {
  addr: number;
  bank: number;
  name: string;
}

interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "ok";
}

interface Ctx {
  rs: RomSet | null;
  setRs: (rs: RomSet | null) => void;
  profile: GameProfile;
  version: number;
  tab: Tab;
  setTab: (t: Tab) => void;
  palette: number[];
  paletteName: string;
  setPalette: (p: number[], name: string, source?: { addr: number; bank: number }) => void;
  paletteSource: { addr: number; bank: number } | null;
  code: { addr: number; bank: number; nonce: number };
  gotoCode: (addr: number, bank?: number) => void;
  hex: { addr: number; bank: number; nonce: number };
  gotoHex: (addr: number, bank?: number) => void;
  tile: { n: number; nonce: number };
  gotoTile: (n: number) => void;
  bookmarks: Bookmark[];
  setBookmarks: (b: Bookmark[]) => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
  labelFor: (addr: number) => string | undefined;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error("no app context");
  return c;
}

/** Re-render when the ROM changes. */
export function useRomVersion() {
  return useApp().version;
}

const BM_KEY = "nghs.bookmarks";

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [rs, setRsState] = useState<RomSet | null>(null);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<Tab>("home");
  const [palette, setPal] = useState<number[]>(DEBUG_PALETTE);
  const [paletteName, setPaletteName] = useState("Debug colors");
  const [paletteSource, setPaletteSource] = useState<{ addr: number; bank: number } | null>(null);
  const [code, setCode] = useState({ addr: 0x100, bank: 0, nonce: 0 });
  const [hex, setHex] = useState({ addr: 0, bank: 0, nonce: 0 });
  const [tile, setTile] = useState({ n: 0, nonce: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bookmarks, setBookmarksState] = useState<Bookmark[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(BM_KEY) ?? "[]");
    } catch {
      return [];
    }
  });
  const toastId = useRef(0);

  useEffect(() => {
    if (!rs) return;
    return rs.subscribe(() => setVersion(rs.version));
  }, [rs]);

  const profile = useMemo(() => (rs ? detectProfile(rs) : GENERIC_PROFILE), [rs]);

  // dev only: window.__hackromOpen(url) loads a zip from the dev server (used for automated checks)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__hackromOpen = async (url: string) => {
      const { loadFiles } = await import("./core/io");
      const blob = await (await fetch(url)).blob();
      const r = await loadFiles([new File([blob], url.split("/").pop() ?? "set.zip")]);
      setRsState(r);
      setVersion(r.version);
      return r.setName;
    };
  }, []);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);

  const setBookmarks = useCallback((b: Bookmark[]) => {
    setBookmarksState(b);
    try {
      localStorage.setItem(BM_KEY, JSON.stringify(b));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const labelFor = useCallback(
    (addr: number) => {
      const bm = bookmarks.find((b) => b.addr === addr);
      if (bm) return bm.name;
      return profile.codeLabels[addr] ?? profile.ram.find((r) => r.addr === addr)?.name;
    },
    [bookmarks, profile],
  );

  const value: Ctx = {
    rs,
    setRs: (r) => {
      setRsState(r);
      setVersion(r?.version ?? 0);
    },
    profile,
    version,
    tab,
    setTab,
    palette,
    paletteName,
    paletteSource,
    setPalette: (p, name, source) => {
      setPal(p);
      setPaletteName(name);
      setPaletteSource(source ?? null);
    },
    code,
    gotoCode: (addr, bank) => {
      setCode((c) => ({ addr: addr & 0xffffff, bank: bank ?? c.bank, nonce: c.nonce + 1 }));
      setTab("code");
    },
    hex,
    gotoHex: (addr, bank) => {
      setHex((h) => ({ addr: addr & 0xffffff, bank: bank ?? h.bank, nonce: h.nonce + 1 }));
      setTab("hex");
    },
    tile,
    gotoTile: (n) => {
      setTile((t) => ({ n, nonce: t.nonce + 1 }));
      setTab("tiles");
    },
    bookmarks,
    setBookmarks,
    toast,
    toasts,
    labelFor,
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
