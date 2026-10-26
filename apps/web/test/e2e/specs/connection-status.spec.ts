import type { Page, WebSocketRoute } from "@playwright/test";
import {
  connected,
  EVENT_CHANNEL_URL,
  expect,
  mockStandaloneApi,
  seedEndpoints,
  test,
  TEST_ENDPOINT,
  waitForWorkspace,
  type EndpointProfile
} from "@srl-labs/containerlab-test-kit/playwright";

const HOST_A: EndpointProfile = { ...TEST_ENDPOINT, id: "endpoint-a", label: "Lab host A" };
const HOST_B: EndpointProfile = { ...TEST_ENDPOINT, id: "endpoint-b", url: "https://lab-b.test:8090", label: "Lab host B" };

type Status = "connected" | "offline" | "session_expired";

/** A stream the page opened on its event channel. */
interface ChannelStream {
  id: string;
  stream: string;
  endpointId?: string;
  closed: boolean;
  socket: WebSocketRoute;
}

/** Live-event streams the test opens, fails and feeds, instead of the app server's. */
async function controlEventStreams(page: Page): Promise<void> {
  const streams: ChannelStream[] = [];
  channelStreams.set(page, streams);
  await page.routeWebSocket(EVENT_CHANNEL_URL, (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id: string; stream?: string; endpointId?: string };
      if (message.type === "open") {
        streams.push({ id: message.id, stream: message.stream ?? "", endpointId: message.endpointId, closed: false, socket });
        socket.send(JSON.stringify({ id: message.id, type: "open" }));
        return;
      }
      const closed = streams.find((stream) => stream.socket === socket && stream.id === message.id);
      if (closed) closed.closed = true;
    });
  });
}

const channelStreams = new WeakMap<Page, ChannelStream[]>();

/** Live-event streams of a lab host the page has opened so far. */
function liveEventStreams(page: Page, endpointId: string): ChannelStream[] {
  return (channelStreams.get(page) ?? []).filter((stream) => stream.stream === "events" && stream.endpointId === endpointId);
}

/** Fails the open live-event stream of a lab host, like a dropped stream or one the server reports failed, or feeds it an event. */
async function onLiveEventStream(page: Page, endpointId: string, action: "fail" | "emit", data?: unknown): Promise<void> {
  await expect.poll(() => liveEventStreams(page, endpointId).some((stream) => !stream.closed)).toBe(true);
  const stream = liveEventStreams(page, endpointId).filter((entry) => !entry.closed).at(-1)!;
  if (action === "emit") {
    stream.socket.send(JSON.stringify({ id: stream.id, type: "event", data: JSON.stringify(data) }));
    return;
  }
  stream.closed = true;
  const error = (data as { error?: string } | undefined)?.error;
  stream.socket.send(JSON.stringify(error === undefined ? { id: stream.id, type: "end" } : { id: stream.id, type: "error", error }));
}

/** Two lab hosts whose API state the test changes through GET /auth/endpoints. */
async function startTwoLabHosts(
  page: Page,
  statuses: Record<string, Status>,
  routes: () => Promise<void> = async () => {}
): Promise<void> {
  await mockStandaloneApi(page, { endpoints: [connected(HOST_A), connected(HOST_B)] });
  await seedEndpoints(page, [HOST_A, HOST_B]);
  await controlEventStreams(page);
  await routes();
  await page.route("**/auth/endpoints", (route) => route.fulfill({
    json: {
      endpoints: [HOST_A, HOST_B].map((endpoint) => ({
        ...endpoint, status: statuses[endpoint.id], connected: statuses[endpoint.id] === "connected"
      }))
    }
  }));
  await page.goto("/");
  await waitForWorkspace(page);
}

test("a failing lab host gets its own banner while the other keeps working", async ({ page }) => {
  const statuses: Record<string, Status> = { [HOST_A.id]: "connected", [HOST_B.id]: "connected" };
  await startTwoLabHosts(page, statuses);
  await expect(page.getByTestId("connection-banner")).toHaveCount(0);

  statuses[HOST_A.id] = "offline";
  await onLiveEventStream(page, HOST_A.id, "fail", { error: "connection refused" });
  const banner = page.getByTestId(`connection-banner-${HOST_A.id}`);
  await expect(banner).toContainText("Lab host A");
  await expect(banner).toContainText("Live events: Reconnecting in");
  // The retry checks the API first, and backs off further while it does not answer.
  await expect(banner).toContainText("API: Unreachable");
  await expect(banner).toContainText(/Live events: Reconnecting in [12] s/);
  await expect(page.getByTestId(`connection-banner-${HOST_B.id}`)).toHaveCount(0);
  await expect(page.getByTestId("workspace-rail")).toBeVisible();
  expect(liveEventStreams(page, HOST_A.id)).toHaveLength(1);

  statuses[HOST_A.id] = "connected";
  await banner.getByRole("button", { name: "Retry now", exact: true }).click();
  await expect(page.getByTestId("connection-banner")).toHaveCount(0);
  expect(liveEventStreams(page, HOST_A.id)).toHaveLength(2);
  expect(liveEventStreams(page, HOST_B.id)).toHaveLength(1);
});

test("an expired sign-in pauses live events and asks to sign in again", async ({ page }) => {
  const statuses: Record<string, Status> = { [HOST_A.id]: "connected", [HOST_B.id]: "connected" };
  await startTwoLabHosts(page, statuses);
  statuses[HOST_B.id] = "session_expired";
  await onLiveEventStream(page, HOST_B.id, "fail");
  const banner = page.getByTestId(`connection-banner-${HOST_B.id}`);
  await expect(banner).toContainText("API: Sign-in expired");
  await expect(banner).toContainText("Live events: Waiting for sign-in");
  await banner.getByRole("button", { name: "Sign in", exact: true }).click();
  const signIn = page.getByRole("dialog", { name: "Sign in to Lab host B" });
  await expect(signIn.getByRole("textbox", { name: "Password" })).toBeVisible();
  await signIn.getByRole("button", { name: "Cancel", exact: true }).click();
  const settings = page.getByTestId("standalone-settings-dialog");
  await settings.getByRole("button", { name: "Close", exact: true }).click();
  await expect(settings).toBeHidden();

  // Hiding the strip keeps the workspace as it is; the problem stays in the explorer.
  await banner.getByRole("button", { name: "Hide connection status of Lab host B", exact: true }).click();
  await expect(banner).toHaveCount(0);
});

const FABRIC_YAML = "name: fabric\ntopology:\n  nodes:\n    leaf1: {}\n    leaf2: {}\n  links:\n    - endpoints: [leaf1:e1, leaf2:e1]\n";

function container(node: string, state: string, status: string) {
  return {
    type: "container",
    action: "start",
    attributes: {
      name: `clab-fabric-${node}`,
      lab: "fabric",
      "lab-path": "fabric/fabric.clab.yml",
      "clab-node-name": node,
      "clab-owner": "admin",
      state,
      status
    }
  };
}

test("running labs show their state, readiness and uptime in the overview", async ({ page }) => {
  const statuses: Record<string, Status> = { [HOST_A.id]: "connected", [HOST_B.id]: "connected" };
  await startTwoLabHosts(page, statuses, async () => {
    await page.route("**/files", (route) => {
      const endpointId = route.request().headers()["x-endpoint-id"];
      const files = endpointId === HOST_A.id
        ? [{ path: "fabric/fabric.clab.yml", labName: "fabric" }]
        : [{ path: "spare/spare.clab.yml", labName: "spare" }];
      return route.fulfill({
        json: files.map(({ path, labName }) => ({
          endpointId, filename: path.split("/").at(-1), path, hasAnnotations: false, labName, deploymentState: "undeployed",
          topologyRef: { topologyId: `standalone:${endpointId}::${path}`, labName, yamlPath: path, source: "standalone" }
        }))
      });
    });
    await page.route("**/api/runtime/file-explorer/file?**", (route) => {
      const path = new URL(route.request().url()).searchParams.get("path");
      return route.fulfill({ json: { endpointId: route.request().headers()["x-endpoint-id"], path, content: FABRIC_YAML } });
    });
  });
  await onLiveEventStream(page, HOST_A.id, "emit", container("leaf1", "running", "Up 2 hours (healthy)"));
  await onLiveEventStream(page, HOST_A.id, "emit", container("leaf2", "running", "Up 2 hours (health: starting)"));

  await page.getByTestId("workspace-overview-button").click();
  const overview = page.getByTestId("labs-overview");
  const running = overview.getByTestId(`lab-card-${HOST_A.id}::fabric/fabric.clab.yml`);
  await expect(running).toHaveAttribute("data-state", "running");
  await expect(running.getByTestId("lab-card-state")).toContainText("Running");
  await expect(running.getByTestId("lab-card-state")).toContainText("up 2 h");
  await expect(running).toContainText("1 of 2 nodes ready");
  await expect(running).toContainText("admin · Lab host A");
  await expect(running.locator("[data-node] image")).toHaveCount(2);
  await expect(running.getByRole("button", { name: "Destroy fabric", exact: true })).toBeVisible();
  const spare = overview.getByTestId(`lab-card-${HOST_B.id}::spare/spare.clab.yml`);
  await expect(spare.getByRole("button", { name: "Deploy spare", exact: true })).toBeVisible();

  await overview.getByTestId("labs-overview-filter-running").click();
  await expect(overview.getByRole("article")).toHaveCount(1);
  await overview.getByTestId("labs-overview-filter-running").click();
  await overview.getByRole("combobox", { name: "Lab host" }).click();
  await page.getByRole("option", { name: "Lab host B", exact: true }).click();
  await expect(overview.getByRole("article")).toHaveCount(1);
  await expect(spare).toBeVisible();
  await overview.getByRole("button", { name: "Clear filters", exact: true }).first().click();

  // A lab host that stops answering leaves the overview with the others' labs.
  statuses[HOST_A.id] = "offline";
  await onLiveEventStream(page, HOST_A.id, "fail");
  await expect(page.getByTestId(`connection-banner-${HOST_A.id}`)).toContainText("API: Unreachable");
  await expect(running).toHaveCount(0);
  await expect(spare).toBeVisible();
  await expect(overview).toBeVisible();
});
