/**
 * Topology editor entry point.
 *
 * The sandbox has no API server. Workspace I/O goes through SandboxBackend
 * (localStorage + in-memory topology sessions). The editor mounts immediately.
 */
import { mountStandaloneApp } from "./standaloneApp";

mountStandaloneApp();

if (import.meta.hot) {
  import.meta.hot.accept("./standaloneApp", () => {
    mountStandaloneApp();
  });
}
