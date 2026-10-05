import { contextBridge, ipcRenderer } from "electron";

// The renderer reaches the main process only through this surface; the page keeps
// contextIsolation and the sandbox, and the main process validates every message.
contextBridge.exposeInMainWorld("containerlabDesktop", {
  platform: process.platform,
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void {
    ipcRenderer.send("containerlab:set-titlebar-overlay", options);
  }
});
