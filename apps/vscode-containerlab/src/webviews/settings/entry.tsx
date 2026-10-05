import { SettingsApp, type SettingsSnapshot } from "@containerlab/clab-ui/settings";
import { MuiThemeProvider } from "@containerlab/clab-ui/theme";

import { renderWebview } from "../shared/mountWebview";

const requests = new Map<
  string,
  {
    resolve: (value: SettingsSnapshot) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }
>();
let sequence = 0;
const subscribers = new Set<(snapshot: SettingsSnapshot) => void>();
window.addEventListener("message", (event: MessageEvent) => {
  const message = event.data as {
    type?: string;
    id?: string;
    error?: string;
    result?: SettingsSnapshot;
    snapshot?: SettingsSnapshot;
  };
  if (message.type === "settings:snapshot" && message.snapshot)
    for (const subscriber of subscribers) subscriber(message.snapshot);
  if (message.type !== "settings:response" || !message.id) return;
  const request = requests.get(message.id);
  if (!request) return;
  clearTimeout(request.timer);
  requests.delete(message.id);
  if (message.error) request.reject(new Error(message.error));
  else request.resolve(message.result as SettingsSnapshot);
});
function request(payload: Record<string, unknown>): Promise<SettingsSnapshot> {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error("VS Code did not respond. Try again."));
    }, 30000);
    requests.set(id, { resolve, reject, timer });
    window.vscode?.postMessage({ ...payload, type: "settings:request", id });
  });
}
function subscribe(listener: (snapshot: SettingsSnapshot) => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
renderWebview(
  <MuiThemeProvider>
    <SettingsApp
      initial={window.__INITIAL_DATA__ as SettingsSnapshot}
      request={request}
      subscribe={subscribe}
    />
  </MuiThemeProvider>
);
