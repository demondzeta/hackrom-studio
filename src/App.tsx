import React, { useEffect } from "react";
import { AppProvider, Tab, useApp } from "./store";
import { ActivePaletteBadge } from "./ui/common";
import { HomeView } from "./views/HomeView";
import { TilesView } from "./views/TilesView";
import { FixView } from "./views/FixView";
import { PalettesView } from "./views/PalettesView";
import { SpritesView } from "./views/SpritesView";
import { CharsView } from "./views/CharsView";
import { CodeView } from "./views/CodeView";
import { HooksView } from "./views/HooksView";
import { HexView } from "./views/HexView";
import { ExportView } from "./views/ExportView";
import { GuideView } from "./views/GuideView";
import { TutorialsView } from "./views/TutorialsView";
import { LiveView } from "./views/LiveView";
import { LiveProvider, useLive } from "./live/live";
import { LangProvider, LangSwitch } from "./i18n";
import { UpdateBadge } from "./ui/DesktopUpdates";
import { tr } from "./i18n";


const NAV: { tab: Tab; label: string; icon: string; hint: string }[] = [
  { tab: "home", label: "ROM set", icon: "◧", hint: "Load a ROM set, game info, files" },
  { tab: "tutorials", label: "Tutorials", icon: "▶", hint: "Step-by-step lessons with examples for every tool" },
  { tab: "live", label: "Live (emulator)", icon: "⚡", hint: "Connect to FBNeo: watch/edit RAM, trigger moves, see tiles on screen, apply edits temporarily" },
  { tab: "tiles", label: "Sprite tiles", icon: "▦", hint: "C-ROM 16×16 tiles: browse, edit, import/export" },
  { tab: "fix", label: "Fix layer", icon: "▤", hint: "S-ROM 8×8 text/HUD tiles" },
  { tab: "palettes", label: "Palettes", icon: "◐", hint: "Browse and edit palettes stored in program ROM" },
  { tab: "sprites", label: "Frame builder", icon: "▣", hint: "Assemble multi-tile sprites, import PNG frames" },
  { tab: "chars", label: "Characters & moves", icon: "✦", hint: "Animations (ACT), hitboxes, command inputs, move routines" },
  { tab: "code", label: "68k code", icon: "⌘", hint: "Disassembler, patch instructions, cross-references" },
  { tab: "hooks", label: "Main loop & hooks", icon: "⟲", hint: "Entry points, main loop detection, code hooks" },
  { tab: "hex", label: "Hex editor", icon: "#", hint: "Raw bytes of any ROM file" },
  { tab: "export", label: "Build & export", icon: "⇩", hint: "Patched ROM zip, IPS patches, project files, history" },
  { tab: "guide", label: "Guides & docs", icon: "?", hint: "Reference: formats, tables, adding characters, testing" },
];

function LiveDot() {
  const { enabled, connected, state } = useLive();
  const { setTab } = useApp();
  if (!enabled) return null;
  return (
    <span className={"livedot" + (connected ? " on" : "")} onClick={() => setTab("live")} title={tr("Emulator link")}>
      <i /> {connected ? `${tr("live")} · ${state?.rom ?? ""}` : tr("live: waiting")}
    </span>
  );
}

function Shell() {
  const { tab, setTab, rs, profile, toasts } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!rs) return;
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) rs.redo();
        else rs.undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        rs.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rs]);

  const View = {
    home: HomeView,
    tutorials: TutorialsView,
    live: LiveView,
    tiles: TilesView,
    fix: FixView,
    palettes: PalettesView,
    sprites: SpritesView,
    chars: CharsView,
    code: CodeView,
    hooks: HooksView,
    hex: HexView,
    export: ExportView,
    guide: GuideView,
  }[tab];

  return (
    <div className="app">
      <aside className="nav">
        <div className="brand">
          <span className="logo">{tr("NEO")}</span>
          <div>
            <b>{tr("HackROM Studio")}</b>
            <small>{tr("Neo Geo ROM editor")}</small>
          </div>
        </div>
        {NAV.map((n) => (
          <button key={n.tab} className={"navbtn" + (tab === n.tab ? " on" : "")} onClick={() => setTab(n.tab)} title={tr(n.hint)}>
            <span className="ico">{n.icon}</span>
            {tr(n.label)}
          </button>
        ))}
        <div className="navfoot">{tr("Edits stay on this computer until you export.")}</div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="title">
            {rs ? (
              <>
                <b>{rs.setName}</b>
                <span className={"tag " + profile.status}>{profile.name}</span>
              </>
            ) : (
              <span className="muted">{tr("No ROM loaded")}</span>
            )}
          </div>
          <div className="spacer" />
          <UpdateBadge />
          <LangSwitch />
          <LiveDot />
          {rs && (
            <>
              <ActivePaletteBadge />
              <button className="btn" disabled={!rs.undoStack.length} onClick={() => rs.undo()} title={tr("Undo (Ctrl+Z)")}>{tr("↶ Undo")}</button>
              <button className="btn" disabled={!rs.redoStack.length} onClick={() => rs.redo()} title={tr("Redo (Ctrl+Y)")}>{tr("↷ Redo")}</button>
              <button className="btn primary" onClick={() => setTab("export")}>{tr("⇩ Export")}</button>
            </>
          )}
        </header>
        <div className="content">
          <View />
        </div>
      </main>
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.kind}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <LiveProvider>
        {/* inside the data providers: a language change re-renders the UI but keeps the loaded ROM and live link */}
        <LangProvider>
          <Shell />
        </LangProvider>
      </LiveProvider>
    </AppProvider>
  );
}
