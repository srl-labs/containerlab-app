import type { CustomIconInfo } from "../../src/core/types/icons";
import type { TopologyAnnotations } from "../../src/core/types/topology";
import type { TopologySnapshot } from "../../src/session";
import type { DevModeInterface } from "../../src/types/devMode";

/** Members main.tsx puts on window.__DEV__ before the app adds its own. */
export interface HarnessDevApi {
  setCustomIcons: (icons: CustomIconInfo[]) => void;
  getCurrentFile: () => string;
  getHostSnapshot: () => Promise<TopologySnapshot>;
  getYamlFromFile: (filename: string) => Promise<string>;
  getAnnotationsFromFile: (filename: string) => Promise<TopologyAnnotations>;
  listTopologyFiles: () => Array<{ filename: string; hasAnnotations: boolean }>;
  loadTopologyFile: (filename: string) => Promise<TopologySnapshot>;
  resetFiles: () => Promise<void>;
  emitCurrentSnapshot: () => Promise<void>;
  writeYamlFile: (filename: string, content: string) => Promise<void>;
  writeAnnotationsFile: (filename: string, content: unknown) => Promise<void>;
}

/** Shape of window.__DEV__ in the harness page. */
export type BrowserDevApi = DevModeInterface & HarnessDevApi;
