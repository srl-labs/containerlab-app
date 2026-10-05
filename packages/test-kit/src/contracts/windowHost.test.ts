import { createWindowClabUiHost } from "@containerlab/clab-ui/host";
import {
  buildTopologySnapshotMessage,
  handleTopologyHostProtocolMessage,
  TopologySessionCore,
  type TopologySnapshot
} from "@containerlab/clab-ui/session";

import { MemoryFileSystem } from "./memoryFileSystem";
import { describeTopologyHostContract } from "./topologyHost";

const YAML_PATH = "/labs/contract.clab.yml";

/** Delivers messages asynchronously in both directions, like a VS Code webview. */
class WebviewWindow extends EventTarget {
  vscode?: { postMessage(message: unknown): void };

  deliver(data: unknown): void {
    setImmediate(() => this.dispatchEvent(new MessageEvent("message", { data })));
  }
}

// The VS Code extension routes webview messages to the shared protocol handler and
// pushes snapshots after its file watcher calls `onExternalChange`.
describeTopologyHostContract("VS Code webview", {
  async createFixture(yaml) {
    const fs = new MemoryFileSystem({ [YAML_PATH]: yaml });
    const core = new TopologySessionCore({
      fs,
      yamlFilePath: YAML_PATH,
      mode: "edit",
      deploymentState: "undeployed"
    });
    const webview = new WebviewWindow();
    webview.vscode = {
      postMessage(message) {
        setImmediate(() => {
          void handleTopologyHostProtocolMessage({
            host: core,
            message,
            postMessage: (response) => webview.deliver(response)
          });
        });
      }
    };
    const host = createWindowClabUiHost({ targetWindow: webview as unknown as Window });

    return {
      host,
      context: { path: YAML_PATH, mode: "edit", deploymentState: "undeployed" },
      readTopology: () => fs.readFile(YAML_PATH),
      writeTopologyExternally: (content) => fs.writeFile(YAML_PATH, content),
      async observeExternalChange() {
        const pushed = new Promise<TopologySnapshot>((resolve) => {
          const unsubscribe = host.subscribe((event) => {
            const message = event.data as Partial<ReturnType<typeof buildTopologySnapshotMessage>>;
            if (message.type === "topology-host:snapshot" && message.reason === "external-change" && message.snapshot) {
              unsubscribe();
              resolve(message.snapshot);
            }
          });
        });
        webview.deliver(buildTopologySnapshotMessage(await core.onExternalChange(), "external-change"));
        return pushed;
      },
      dispose: () => core.dispose()
    };
  }
});
