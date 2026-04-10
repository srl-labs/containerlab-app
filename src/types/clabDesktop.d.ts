interface ClabDesktopAppInfo {
  platform: NodeJS.Platform;
  version: string;
}

interface ClabDesktopBridge {
  getAppInfo: () => Promise<ClabDesktopAppInfo>;
  openExternal: (url: string) => Promise<void>;
}

declare global {
  interface Window {
    clabDesktop?: ClabDesktopBridge;
  }
}

export {};
