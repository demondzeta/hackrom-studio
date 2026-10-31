// Automatic updates (electron-updater). The update address is a folder on a web server holding latest.yml
// and the installer, e.g. https://github.com/OWNER/REPO/releases/latest/download
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { autoUpdater } = require("electron-updater");
const pkg = require("../package.json");

const configFile = () => path.join(app.getPath("userData"), "update.json");
let status = { state: "idle", version: null, percent: 0, error: null };

function readUrl() {
  try {
    const url = JSON.parse(fs.readFileSync(configFile(), "utf8")).url;
    if (typeof url === "string") return url;
  } catch {
    /* no saved address */
  }
  return pkg.hackrom?.updateUrl ?? "";
}

/** Updates run with full rights, so they must come over https (plain http only for local testing). */
function validUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
}

function setStatus(next) {
  status = { ...status, ...next };
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send("update-status", status);
}

async function check() {
  const url = readUrl();
  if (!app.isPackaged) return setStatus({ state: "dev", error: null });
  if (!url) return setStatus({ state: "no-url", error: null });
  if (!validUrl(url)) return setStatus({ state: "error", error: "bad-url" });
  autoUpdater.setFeedURL({ provider: "generic", url });
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    setStatus({ state: "error", error: String(e?.message ?? e).split("\n")[0] });
  }
}

function setup(ipcMain) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => setStatus({ state: "checking", error: null }));
  autoUpdater.on("update-available", (i) => setStatus({ state: "downloading", version: i.version, percent: 0 }));
  autoUpdater.on("update-not-available", () => setStatus({ state: "latest", version: null }));
  autoUpdater.on("download-progress", (p) => setStatus({ state: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => setStatus({ state: "ready", version: i.version, percent: 100 }));
  autoUpdater.on("error", (e) => setStatus({ state: "error", error: String(e?.message ?? e).split("\n")[0] }));
  ipcMain.handle("update:info", () => ({ version: app.getVersion(), url: readUrl(), status }));
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:install", () => {
    if (status.state === "ready") autoUpdater.quitAndInstall(true, true);
  });
  ipcMain.handle("update:set-url", (_e, url) => {
    const clean = String(url).trim().replace(/\/+$/, "");
    if (clean && !validUrl(clean)) return false;
    fs.writeFileSync(configFile(), JSON.stringify({ url: clean }));
    check();
    return true;
  });
}

const checkOnStart = () => check();

module.exports = { setup, checkOnStart };
