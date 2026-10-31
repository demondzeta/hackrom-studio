import React, { useState } from "react";
import { hex, hex8 } from "../core/bytes";
import { readHeader } from "../core/analysis";
import { loadFiles } from "../core/io";
import { buildDemoSet } from "../core/demo";
import { RomSet } from "../core/romset";
import { Tab, useApp } from "../store";
import { Addr, Panel } from "../ui/common";
import { tr, Tx } from "../i18n";
import { DesktopUpdatesPanel } from "../ui/DesktopUpdates";


const ROLE_NAMES: Record<string, string> = { p: "68k program", s: "Fix layer (S)", c: "Sprites (C)", m: "Z80 sound code", v: "ADPCM samples", other: "Other" };

export function HomeView() {
  const { rs, setRs, toast, profile, setTab } = useApp();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const r = await loadFiles(files);
      setRs(r);
      toast(`Loaded ${r.setName}: ${r.files.length} files`, "ok");
    } catch (e: any) {
      toast(tr("Could not load: {msg}", { msg: e.message }), "error");
    } finally {
      setBusy(false);
    }
  };

  const pick = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.multiple = true;
    inp.accept = ".zip,.p1,.p2,.sp2,.ep1,.ep2,.pn1,.s1,.c1,.c2,.c3,.c4,.c5,.c6,.c7,.c8,.m1,.v1,.v2,.v3,.v4,.bin,.rom";
    inp.onchange = () => open(Array.from(inp.files ?? []));
    inp.click();
  };

  const dropZone = (
    <div
      className={"drop" + (over ? " over" : "")}
      onClick={pick}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        open(Array.from(e.dataTransfer.files));
      }}
    >
      <h2>{busy ? tr("Loading…") : rs ? tr("Drop another ROM set to replace") : tr("Drop a Neo Geo ROM set here")}</h2>
      <p className="muted"><Tx s="A MAME zip (e.g. `kof97.zip`) or the loose files (`232-p1.p1`, `232-p2.sp2`, `232-c1.c1`…). Nothing is uploaded: everything stays on this computer." /></p>
      <div className="row" style={{ justifyContent: "center" }}>
        <button className="btn primary">{tr("Choose files…")}</button>
        <button
          className="btn"
          onClick={(e) => {
            e.stopPropagation();
            setRs(RomSet.fromFiles("demo-kof97-synthetic", buildDemoSet()));
            toast(tr("Loaded the synthetic demo set (generated data shaped like KOF97)"), "ok");
          }}
          title={tr("A small generated set with the KOF97 layout — no game data — to try every tool")}
        >{tr("Try the synthetic demo set")}</button>
      </div>
    </div>
  );

  if (!rs)
    return (
      <div className="col" style={{ maxWidth: 980 }}>
        {dropZone}
        <DesktopUpdatesPanel />
        <Panel title={tr("What you can do")}>
          <div className="cards">
            {[
              ["Sprite tiles", "See every 16×16 C-ROM tile with its tile number and file offsets, edit pixels, import/export PNG."],
              ["Palettes", "Find and edit the palettes stored in P-ROM, with named character palettes for KOF97/98."],
              ["Characters & moves", "Read KOF animation scripts (ACT): frames, timing, hit/hurt boxes, damage effects, cancels, command inputs."],
              ["68k code", "Disassemble, follow calls, patch instructions with the built-in assembler."],
              ["Main loop & hooks", "Find the main loop and insert your own code each frame with a safe detour."],
              ["Build", "Download a patched zip that MAME can run, IPS patches or a project file of your edits."],
            ].map(([t, d]) => (
              <div className="card" key={t}>
                <b>{tr(t)}</b>
                <span className="muted">{tr(d)}</span>
              </div>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 12 }}><Tx s="Best test targets: **kof97** (no encryption, fully documented here) and **kof98n/kof98h** (unencrypted P1). Sets from KOF99 on use encrypted C-ROMs (CMC) and need decrypted dumps." /></p>
        </Panel>
      </div>
    );

  const h = readHeader(rs);
  const quick: [Tab, string, string][] = [
    ["tiles", "Sprite tiles", "Browse and edit C-ROM tiles"],
    ["palettes", "Palettes", profile.paletteSet ? "Character palettes ready" : "Scan P-ROM for palettes"],
    ["chars", "Characters & moves", profile.kof ? "ACT scripts, hitboxes, commands" : "Needs a KOF profile"],
    ["hooks", "Main loop & hooks", "Entry points and loop detection"],
  ];

  return (
    <div className="col">
      <div className="grid2">
        <Panel title={tr("Game")}>
          <h2>{profile.name}</h2>
          <div className="kv">
            <span>{tr("NGH")}</span>
            <span className="mono">{hex(h.ngh, 4)}</span>
            <span>{tr("Header")}</span>
            <span>{h.valid ? <span className="ok">{tr("NEO-GEO header found")}</span> : <span className="err">{tr("no NEO-GEO header (encrypted P1?)")}</span>}</span>
            <span>{tr("Profile")}</span>
            <span>
              <span className={"tag " + profile.status}>{profile.status}</span>
            </span>
            <span>{tr("Program banks")}</span>
            <span>
              {rs.banks.length
                ? rs.banks.map((b, i) => `#${i}: ${rs.files[b.file].name}+${hex(b.offset)} (id ${hex(rs.read16(0x200000, i), 4)})`).join(" · ")
                : "none"}
            </span>
          </div>
          <ul>
            {profile.notes.map((n) => (
              <li key={n}>{tr(n)}</li>
            ))}
          </ul>
        </Panel>
        <Panel title={tr("Entry points")}>
          <table className="t">
            <tbody>
              {h.entries.map((e) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td>{e.target !== null ? <Addr a={e.target} /> : <span className="muted">—</span>}</td>
                  <td className="muted small">{tr(e.note)}</td>
                </tr>
              ))}
              {h.vectors
                .filter((v) => v.vector >= 0x64)
                .map((v) => (
                  <tr key={v.name}>
                    <td>{v.name}</td>
                    <td>
                      <Addr a={v.target} />
                    </td>
                    <td className="muted small">{v.target >= 0xc00000 ? "points into the BIOS" : "game handler"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </Panel>
      </div>
      <div className="cards">
        {quick.map(([t, title, d]) => (
          <div className="card" key={t} onClick={() => setTab(t)}>
            <b>{tr(title)} →</b>
            <span className="muted">{tr(d)}</span>
          </div>
        ))}
      </div>
      <Panel title={tr("Files")}>
        <table className="t">
          <thead>
            <tr>
              <th>{tr("File")}</th>
              <th>{tr("Type")}</th>
              <th>{tr("Size")}</th>
              <th>{tr("CRC32 (original)")}</th>
              <th>{tr("Byte order")}</th>
              <th>{tr("Status")}</th>
            </tr>
          </thead>
          <tbody>
            {rs.files.map((f, i) => (
              <tr key={f.name}>
                <td className="mono">{f.name}</td>
                <td>{tr(ROLE_NAMES[f.role])}</td>
                <td className="mono">{(f.data.length / 1024 / 1024).toFixed(f.data.length < 1 << 20 ? 3 : 1)}{" "}{tr("MB")}</td>
                <td className="mono">{hex8(f.origCrc)}</td>
                <td className="muted">{f.role === "p" ? (f.swapped ? "word-swapped (MAME)" : "big-endian") : "—"}</td>
                <td>{rs.isModified(i) ? <span className="warn">{tr("modified")}</span> : <span className="muted">{tr("original")}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {dropZone}
      <DesktopUpdatesPanel />
    </div>
  );
}
