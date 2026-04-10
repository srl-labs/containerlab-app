import { contextBridge, ipcRenderer } from "electron";

export interface DesktopAppInfo {
  platform: NodeJS.Platform;
  version: string;
}

export interface DesktopBridge {
  getAppInfo: () => Promise<DesktopAppInfo>;
  openExternal: (url: string) => Promise<void>;
}

const bridge: DesktopBridge = {
  getAppInfo: async () => {
    return await ipcRenderer.invoke("desktop:get-app-info");
  },
  openExternal: async (url: string) => {
    await ipcRenderer.invoke("desktop:open-external", url);
  }
};

contextBridge.exposeInMainWorld("clabDesktop", bridge);
