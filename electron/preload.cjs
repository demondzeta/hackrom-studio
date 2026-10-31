// The only desktop features the page can reach.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hackromDesktop", {
  info: () => ipcRenderer.invoke("update:info"),
  check: () => ipcRenderer.invoke("update:check"),
  install: () => ipcRenderer.invoke("update:install"),
  setUrl: (url) => ipcRenderer.invoke("update:set-url", url),
  onStatus: (fn) => {
    const listener = (_e, status) => fn(status);
    ipcRenderer.on("update-status", listener);
    return () => ipcRenderer.removeListener("update-status", listener);
  },
});
