import React, { useMemo, useState } from "react";
import { downloadBlob, hex, hex6 } from "../core/bytes";
import { applyProject, CrcFix, crcReport, exportFbneoIps, exportZip, ipsWindows, makeIps, makeProject, ProjectFile } from "../core/io";
import { useApp } from "../store";
import { NeedRom, Panel, pickFile } from "../ui/common";
import { tr, Tx } from "../i18n";

export function ExportView() {
  const { rs, version, toast, bookmarks, setBookmarks } = useApp();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [keepCrc, setKeepCrc] = useState(true);
  const [fixes, setFixes] = useState<CrcFix[]>([]);
  const [hackName, setHackName] = useState("my_hack");
  const report = useMemo(() => (rs ? crcReport(rs, keepCrc) : []), [rs, version, keepCrc]);

  if (!rs) return <NeedRom />;
  const modified = report.filter((r) => r.modified);

  const zip = () => {
    setBusy(true);
    setTimeout(() => {
      try {
        const out = exportZip(rs, keepCrc);
        downloadBlob(out.zip, `${rs.setName}.zip`, "application/zip");
        setFixes(out.fixes);
        const failed = out.fixes.filter((f) => f.offset < 0);
        if (failed.length) toast(tr("Zip built, but no free filler bytes to keep the CRC of: {names}", { names: failed.map((f) => f.name).join(", ") }), "error");
        else toast(tr("Zip built"), "ok");
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  return (
    <div className="col">
      <div className="grid2">
        <Panel title={tr("Build a playable ROM set")}>
          <p><Tx s="Downloads **{name}.zip** with every file (edited ones included) in the original byte order and file names, ready for MAME / FinalBurn." vars={{ name: rs.setName }} /></p>
          <button className="btn primary" disabled={busy} onClick={zip}>
            {busy ? tr("Building…") : tr("⇩ Download {name}.zip", { name: rs.setName })}
          </button>
          <label className="row" style={{ marginTop: 10, gap: 6 }}>
            <input type="checkbox" checked={keepCrc} onChange={(e) => setKeepCrc(e.target.checked)} />
            <span>{tr("Keep the original CRC32 of edited files")}</span>
          </label>
          <p className="muted small">{tr("FBNeo, Fightcade and RetroArch refuse or warn about sets with wrong CRCs. With this on, 4 bytes in an unused filler area (a run of 00 or FF) of each edited file are adjusted so the CRC32 matches the original dump. MAME also checks SHA1, so it still warns but runs.")}</p>
          {keepCrc && fixes.length > 0 && (
            <table className="t">
              <tbody>
                {fixes.map((f) => (
                  <tr key={f.name}>
                    <td className="mono">{f.name}</td>
                    <td className={f.offset < 0 ? "warn" : "mono small muted"}>{f.offset < 0 ? tr("no free filler found, CRC changed") : tr("CRC bytes at file offset {off}", { off: hex6(f.offset) })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="notice info" style={{ marginTop: 12 }}>
            <Tx s="**Running it:** MAME checks CRCs. Put the zip in a separate roms folder and run `mame {name} -rompath your_folder`. MAME will report “WRONG CHECKSUMS” for edited files and still start. FBNeo shows a warning: press OK. For a permanent hack, add a clone entry or use the IPS patches with the original set." vars={{ name: rs.setName }} /></div>
        </Panel>
        <Panel title={tr("FBNeo IPS patch package")}>
          <p>{tr("Keeps your original set untouched: FBNeo checks the original CRCs, then applies the patches in memory when the game loads. No checksum warnings.")}</p>
          <label className="row" style={{ gap: 6, marginBottom: 8 }}>
            <span>{tr("patch name")}</span>
            <input value={hackName} onChange={(e) => setHackName(e.target.value)} style={{ flex: 1 }} />
          </label>
          <button
            className="btn primary"
            disabled={!modified.length}
            onClick={() => {
              const safe = hackName.trim().replace(/[^A-Za-z0-9_-]+/g, "_") || "hack";
              downloadBlob(exportFbneoIps(rs, hackName, notes), `${rs.setName}_${safe}_fbneo_ips.zip`, "application/zip");
              toast(tr("IPS package built"), "ok");
            }}
          >{tr("⇩ Download FBNeo IPS package")}</button>
          <div className="notice info" style={{ marginTop: 12 }}>
            <Tx s="**Installing it:** unzip into the FBNeo folder (the one with `support`) with “Extract here”, so the `.dat` and `.ips` files land directly in `support/ips/{name}/`. If they end up in a subfolder, FBNeo can't find them and IPS Manager stays grayed out. Keep the **original** `{name}.zip` in your roms folder. In FBNeo open Game → Load Game, select the game, press **IPS Manager**, tick the patch and press Play. The project notes are used as the patch description." vars={{ name: rs.setName }} />
          </div>
        </Panel>
      </div>
      <div className="grid2">
        <Panel title={tr("Changed files")}>
          {modified.length === 0 ? (
            <p className="muted">{tr("Nothing changed yet.")}</p>
          ) : (
            <table className="t">
              <thead>
                <tr>
                  <th>{tr("file")}</th>
                  <th>{tr("CRC before")}</th>
                  <th>{tr("CRC now")}</th>
                  <th>{tr("regions")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {modified.map((r) => {
                  const i = rs.files.findIndex((f) => f.name === r.name);
                  return (
                    <tr key={r.name}>
                      <td className="mono">{r.name}</td>
                      <td className="mono">{r.original}</td>
                      <td className={r.current === r.original ? "mono" : "mono warn"}>{r.current}</td>
                      <td>{rs.diff(i).length}</td>
                      <td>
                        <button className="btn sm" onClick={() => ipsWindows(rs, i).forEach((w) => downloadBlob(makeIps(rs, i, keepCrc, w), w ? `${r.name}.${w * 16}MB.ips` : `${r.name}.ips`))}>{tr("IPS")}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title={tr("Project file")}>
          <p className="muted">{tr("Saves only your changes (plus bookmarks and notes) as JSON. Load it later on a clean copy of the same set to continue.")}</p>
          <textarea rows={4} placeholder={tr("notes for this hack…")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={() => downloadBlob(JSON.stringify(makeProject(rs, notes, bookmarks), null, 1), `${rs.setName}.hackproj.json`, "application/json")}>{tr("Save project")}</button>
            <button
              className="btn"
              onClick={async () => {
                const f = await pickFile(".json,application/json");
                if (!f) return;
                try {
                  const p = JSON.parse(await f.text()) as ProjectFile;
                  if (p.app !== "neogeo-hackrom-studio") throw new Error("not a project file");
                  const warns = applyProject(rs, p);
                  if (p.notes) setNotes(p.notes);
                  if (p.bookmarks?.length) setBookmarks([...bookmarks, ...p.bookmarks.filter((b) => !bookmarks.some((x) => x.addr === b.addr))]);
                  toast(warns.length ? tr("Loaded with warnings: {w}", { w: warns.join("; ") }) : tr("Project applied"), warns.length ? "error" : "ok");
                } catch (e: any) {
                  toast(tr("Could not load project: {msg}", { msg: e.message }), "error");
                }
              }}
            >{tr("Load project…")}</button>
          </div>
        </Panel>
      </div>
      <div className="col">
        <Panel title={tr("Edit history ({n})", { n: rs.undoStack.length })} scroll>
          {rs.undoStack.length === 0 ? (
            <p className="muted">{tr("No edits.")}</p>
          ) : (
            <table className="t">
              <tbody>
                {[...rs.undoStack]
                  .reverse()
                  .slice(0, 200)
                  .map((e, i) => (
                    <tr key={i}>
                      <td className="small muted">{new Date(e.time).toLocaleTimeString()}</td>
                      <td>{e.label}</td>
                      <td className="mono small muted">
                        {e.parts ? `${e.parts.length} writes` : `${rs.files[e.file]?.name}@${hex(e.offset)} (${e.after.length})`}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}
