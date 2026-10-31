// Version and updates, shown only in the installed desktop app.
import React, { useEffect, useState } from "react";
import { tr } from "../i18n";
import { useApp } from "../store";
import { Panel } from "./common";

interface UpdateStatus {
  state: "idle" | "dev" | "no-url" | "checking" | "latest" | "downloading" | "ready" | "error";
  version: string | null;
  percent: number;
  error: string | null;
}
interface DesktopApi {
  info(): Promise<{ version: string; url: string; status: UpdateStatus }>;
  check(): Promise<void>;
  install(): Promise<void>;
  setUrl(url: string): Promise<boolean>;
  onStatus(fn: (s: UpdateStatus) => void): () => void;
}
const desktop = (window as unknown as { hackromDesktop?: DesktopApi }).hackromDesktop;
export const isDesktop = !!desktop;

function useUpdates() {
  const [version, setVersion] = useState("");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.info().then((i) => {
      setVersion(i.version);
      setUrl(i.url);
      setStatus(i.status);
    });
    return desktop.onStatus(setStatus);
  }, []);
  return { version, url, setUrl, status };
}

function useInstall() {
  const { rs } = useApp();
  return () => {
    if (rs?.undoStack.length && !confirm(tr("The app will restart. Unsaved ROM edits are lost: export or save a project first. Restart now?"))) return;
    desktop?.install();
  };
}

/** Top bar: only appears when there is something to do. */
export function UpdateBadge() {
  const { status } = useUpdates();
  const install = useInstall();
  if (status?.state === "ready") return <button className="btn sm primary" onClick={install}>{tr("Restart to update to {v}", { v: status.version ?? "" })}</button>;
  if (status?.state === "downloading") return <span className="muted small">{tr("Downloading update… {p}%", { p: status.percent })}</span>;
  return null;
}

function statusText(s: UpdateStatus | null) {
  if (!s) return "";
  switch (s.state) {
    case "no-url": return tr("No update address set.");
    case "checking": return tr("Checking for updates…");
    case "latest": return tr("You have the latest version.");
    case "downloading": return tr("Downloading update… {p}%", { p: s.percent });
    case "ready": return tr("Version {v} is ready to install. It also installs when you close the app.", { v: s.version ?? "" });
    case "error": return s.error === "bad-url" ? tr("The update address must start with https://") : tr("Update check failed: {msg}", { msg: s.error ?? "" });
    case "dev": return tr("Updates only work in the installed app.");
    default: return "";
  }
}

export function DesktopUpdatesPanel() {
  const { version, url, setUrl, status } = useUpdates();
  const install = useInstall();
  const [bad, setBad] = useState(false);
  if (!desktop) return null;
  const save = async () => setBad(!(await desktop.setUrl(url)));
  return (
    <Panel title={tr("HackROM Studio {v}", { v: version })}>
      <div className="col">
        <div className="row">
          <button className="btn" disabled={status?.state === "checking" || status?.state === "downloading"} onClick={() => desktop.check()}>{tr("Check for updates")}</button>
          {status?.state === "ready" && <button className="btn primary" onClick={install}>{tr("Restart to update to {v}", { v: status.version ?? "" })}</button>}
          <span className="muted small">{statusText(status)}</span>
        </div>
        <div className="row">
          <label className="f" style={{ flex: 1 }}>
            {tr("Update address")}{" "}
            <input className="inp mono" style={{ width: "70%" }} placeholder="https://github.com/OWNER/REPO/releases/latest/download" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <button className="btn sm" onClick={save}>{tr("Save")}</button>
        </div>
        {bad && <div className="notice err small">{tr("The update address must start with https://")}</div>}
      </div>
    </Panel>
  );
}
