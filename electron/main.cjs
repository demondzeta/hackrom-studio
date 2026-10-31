// HackROM Studio desktop app. The UI is served through the private hackrom:// scheme instead of a local
// web server: the live link can run Lua inside FBNeo, so it must not be reachable from web pages.
const { app, BrowserWindow, Menu, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { readState, writeCommands } = require("./liveBridge.cjs");
const updates = require("./updates.cjs");

const ORIGIN = "hackrom://app";
const distDir = path.join(app.getAppPath(), "dist");
const liveDir = path.resolve(process.env.HACKROM_LIVE_DIR ?? os.tmpdir());

protocol.registerSchemesAsPrivileged([{ scheme: "hackrom", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/**
 * The live scripts are copied to Documents, where FBNeo can keep the same path across updates and
 * my_program.lua and quick.fs survive them. Only the files shipped with the app are overwritten.
 */
function installLiveScripts() {
  const from = app.isPackaged ? path.join(process.resourcesPath, "live") : path.join(app.getAppPath(), "tools", "live");
  const to = path.join(app.getPath("documents"), "HackROM Studio", "live");
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) if (f.endsWith(".lua")) fs.copyFileSync(path.join(from, f), path.join(to, f));
    return path.join(to, "hackrom_live.lua");
  } catch (e) {
    console.error("could not copy the live scripts", e);
    return path.join(from, "hackrom_live.lua");
  }
}

function serve(script) {
  protocol.handle("hackrom", async (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("not found", { status: 404 });
    const json = (body) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (url.pathname === "/__live/state" && request.method === "GET") return json(readState(liveDir, script));
    if (url.pathname === "/__live/cmd" && request.method === "POST") return json(writeCommands(liveDir, await request.text()));
    const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname).slice(1);
    const file = path.resolve(distDir, rel);
    if (!file.startsWith(distDir + path.sep)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#11141b",
    title: "HackROM Studio",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // stay inside the app; real web links open in the browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN + "/")) e.preventDefault();
  });
  win.loadURL(ORIGIN + "/");
  return win;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    serve(installLiveScripts());
    updates.setup(ipcMain);
    createWindow();
    updates.checkOnStart();
  });
  app.on("window-all-closed", () => app.quit());
}
