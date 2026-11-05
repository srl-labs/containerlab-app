import { test, expect, type Page } from "@playwright/test";

interface FabricControls {
  calls: string[];
  emit: (event: Record<string, unknown>) => void;
  closeStreams: () => void;
  setNodeHealth: (node: string, health: string) => void;
  setEngineState: (state: string) => void;
}

declare global {
  interface Window {
    __FABRIC__: FabricControls;
  }
}

async function open(page: Page, state = "ready", theme = "dark-modern"): Promise<void> {
  await page.goto(`/webviews.html?view=fabric&state=${state}&theme=${theme}`);
  await expect(page.getByTestId("fabric-app")).toBeVisible();
}

async function calls(page: Page): Promise<string[]> {
  return page.evaluate(() => window.__FABRIC__.calls);
}

async function nav(page: Page, id: string): Promise<void> {
  await page.getByTestId(id).click();
}

test.describe("the engine", () => {
  test("starts by itself on opening, once, and shows the fabric when it answers", async ({ page }) => {
    await open(page, "fresh");
    await expect(page.getByTestId("fabric-topology")).toBeVisible();
    const made = await calls(page);
    expect(made.filter((call) => call === "engine-start")).toHaveLength(1);
  });

  test("says what it is doing while its image is pulled", async ({ page }) => {
    await open(page, "pulling");
    await expect(page.getByTestId("fabric-engine-starting")).toContainText("first start downloads");
    await expect(page.getByTestId("fabric-nav")).toHaveCount(0);
  });

  test("shows why it failed, and retries", async ({ page }) => {
    await open(page, "failed");
    await expect(page.getByTestId("fabric-engine-error")).toContainText("lists no SR Linux nodes");
    await page.getByTestId("fabric-engine-retry").click();
    await expect(page.getByTestId("fabric-topology")).toBeVisible();
  });

  test("stops from the menu, keeps its history, and starts again", async ({ page }) => {
    await open(page);
    await page.getByTestId("fabric-menu").click();
    await page.getByTestId("fabric-stop-engine").click();
    await expect(page.getByTestId("fabric-engine-stopped")).toContainText("history is kept");
    await page.getByTestId("fabric-engine-start").click();
    await expect(page.getByTestId("fabric-topology")).toBeVisible();
  });

  test("that stops on its own offers a start instead of errors", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live");
    await page.evaluate(() => {
      window.__FABRIC__.setEngineState("stopped");
      window.__FABRIC__.closeStreams();
    });
    await expect(page.getByTestId("fabric-engine-stopped")).toContainText("not running");
    await expect(page.getByRole("alert")).toHaveCount(0);
    const made = await calls(page);
    expect(made.filter((call) => call === "engine-start")).toHaveLength(0);
  });

  test("offers only the fabric's own views", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-nav")).toBeVisible();
    await expect(page.getByRole("button", { name: /\bask\b/i })).toHaveCount(0);
    await nav(page, "fabric-nav-incidents");
    await expect(page.getByTestId("fabric-incidents")).toBeVisible();
    expect((await calls(page)).some((call) => /chat|mcp/.test(call))).toBe(false);
  });
});

test.describe("the topology", () => {
  test("draws nodes with their health, and cables by state", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-topology-node-leaf1")).toHaveAttribute("data-health", "error");
    await expect(page.getByTestId("fabric-topology-node-leaf2")).toHaveAttribute("data-health", "ok");
    await expect(page.getByTestId("fabric-topology-link-leaf1|spine1")).toHaveAttribute("data-state", "lost");
    const dashes = await page.getByTestId("fabric-topology-link-leaf1|spine1").locator("path").last().evaluate((path) => getComputedStyle(path).strokeDasharray);
    expect(dashes).not.toBe("none");
  });

  test("a node opens its details: platform, findings and cables", async ({ page }) => {
    await open(page);
    await page.getByTestId("fabric-topology-node-leaf1").click();
    const details = page.getByTestId("fabric-topology-details");
    await expect(details).toContainText("26.7.2");
    await expect(details.getByTestId("fabric-details-finding")).toHaveCount(2);
    await expect(details).toContainText("ethernet-1/50");
    expect(await calls(page)).toContain("GET reports/sys-info?node=leaf1");
    await page.getByTestId("fabric-details-close").click();
    await expect(details).toHaveCount(0);
  });

  test("a cable opens both directions' rates and the findings on its ports", async ({ page }) => {
    await open(page);
    // Cables cross, so a click at the middle of its box could land on another one.
    await page.getByTestId("fabric-topology-link-leaf1|spine2").dispatchEvent("click");
    const details = page.getByTestId("fabric-topology-details");
    await expect(details).toContainText("leaf1 sends");
    await expect(details).toContainText("1.2 Mbps");
    await expect(details).toContainText("450 Kbps");
  });

  test("clients show when asked for, with their segment", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-topology-client-lldp:host1")).toHaveCount(0);
    await page.getByTestId("fabric-show-clients").click();
    await page.getByTestId("fabric-topology-client-es:00:01").click();
    const details = page.getByTestId("fabric-topology-details");
    await expect(details).toContainText("es-host2");
    await expect(details).toContainText("all-active");
    await expect(details).toContainText("lag1.0");
  });

  test("pans, zooms and fits", async ({ page }) => {
    await open(page);
    const canvas = page.getByTestId("fabric-topology-canvas");
    const drawing = page.locator('[data-testid="fabric-topology-canvas"] > g');
    // The first frame is drawn fitted to the room the page has by then.
    await expect(drawing).not.toHaveAttribute("transform", "translate(0,0) scale(1)");
    const start = await drawing.getAttribute("transform");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("no canvas");
    await page.mouse.move(box.x + 8, box.y + box.height - 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height - 20, { steps: 4 });
    await page.mouse.up();
    await expect(drawing).not.toHaveAttribute("transform", start ?? "");
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.wheel(0, -200);
    await expect(drawing).not.toHaveAttribute("transform", /scale\(1\)/);
    await page.getByTestId("fabric-fit").click();
    await expect(drawing).toHaveAttribute("transform", start ?? "");
  });

  test("traffic colours by rate, against a rate it counts as full", async ({ page }) => {
    await open(page);
    await page.getByTestId("fabric-mode-traffic").click();
    await expect(page.getByTestId("fabric-topology-legend")).toContainText("Under 25%");
    await expect(page.getByTestId("fabric-link-rate")).toBeVisible();
    await page.getByTestId("fabric-mode-health").click();
  });

  test("an empty fabric says so", async ({ page }) => {
    await open(page, "empty");
    await expect(page.getByText("No SR Linux nodes to draw")).toBeVisible();
  });
});

test.describe("the other views", () => {
  test("nodes list their stream and why one is down", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-nodes");
    await expect(page.getByTestId("fabric-node-row-leaf4")).toContainText("connection refused");
    await expect(page.getByTestId("fabric-nodes-table").locator("tbody tr").first()).toContainText("leaf4");
    await page.getByTestId("fabric-node-row-leaf1").getByRole("button", { name: "leaf1" }).click();
    await expect(page.getByTestId("fabric-topology-details")).toBeVisible();
  });

  test("incidents read worst first, and an ack takes one out of the counts", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-incident-counts")).toContainText("1");
    await nav(page, "fabric-nav-incidents");
    const cards = page.locator('[data-testid^="fabric-incident-"][data-severity]');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveAttribute("data-severity", "error");
    await expect(cards.first()).toContainText("It accounts for 1 interface down");
    await expect(cards.first()).toContainText("session is active");

    await page.getByTestId("fabric-incidents-info").click();
    await expect(cards).toHaveCount(3);

    await page.getByTestId("fabric-ack-link|leaf1:ethernet-1/49+spine1:ethernet-1/1").click();
    await expect(page.getByTestId("fabric-incidents-acknowledged")).toBeVisible();
    await expect(page.getByTestId("fabric-incidents-only-error")).toContainText("0 errors");
  });

  test("an incident says what changed just before it", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-incidents");
    await expect(page.locator('[data-testid="fabric-change"]').first()).toBeVisible();
    const made = await calls(page);
    expect(made.some((call) => call.startsWith("GET history") && call.includes("until="))).toBe(true);
  });

  test("history filters, by what caused it and by search on the server", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-history");
    await expect(page.getByTestId("fabric-timeline")).toBeVisible();
    await expect(page.getByTestId("fabric-change")).toHaveCount(11);
    await page.getByTestId("fabric-origin-unplanned").click();
    await expect(page.getByTestId("fabric-change")).toHaveCount(5);
    await page.getByTestId("fabric-origin-everything").click();
    await page.getByTestId("fabric-history-search").fill("port-admin-disabled");
    await expect(page.getByTestId("fabric-change")).toHaveCount(2);
    expect((await calls(page)).some((call) => call.includes("q=port-admin-disabled"))).toBe(true);
  });

  test("a finding reads as raised or cleared, and a commit opens its diff side by side", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-history");
    await expect(page.locator('[data-testid="fabric-change"][data-kind="finding"]').first()).toContainText(/raised|cleared/);
    await page.locator('[data-testid="fabric-change"][data-kind="config-commits"] [role="button"]').click();
    const diff = page.getByTestId("fabric-config-diff");
    await expect(diff).toContainText("~1 changed");
    await expect(diff.locator("mark").first()).toHaveText(/en|dis/);
    await expect(diff).toContainText("536 unchanged lines");
  });

  test("a baseline shows what changes from here on", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-history");
    await expect(page.getByTestId("fabric-window-baseline")).toBeDisabled();
    await page.getByTestId("fabric-set-baseline").click();
    await expect(page.getByTestId("fabric-history-count")).toContainText("since ");
    expect((await calls(page)).some((call) => call.startsWith("POST baselines"))).toBe(true);
  });

  test("where says when an address is nowhere, or on two nodes that disagree", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-lens-where");
    await page.getByTestId("fabric-lens-address").fill("10.8.8.8");
    await page.getByTestId("fabric-lens-submit").click();
    await expect(page.getByTestId("fabric-where-summary")).toContainText("nowhere");
    await page.getByTestId("fabric-lens-address").fill("10.1.1.99");
    await page.getByTestId("fabric-lens-submit").click();
    await expect(page.getByTestId("fabric-where-summary")).toContainText("Duplicate");
    await expect(page.getByTestId("fabric-table").locator("tbody tr")).toHaveCount(2);
  });

  test("path traces hop by hop to its outcome", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-lens-path");
    await page.getByTestId("fabric-lens-source").fill("leaf1");
    await page.getByTestId("fabric-lens-destination").fill("10.0.1.3");
    await page.getByTestId("fabric-lens-submit").click();
    await expect(page.getByTestId("fabric-path-outcome")).toContainText("delivered on leaf3");
    await expect(page.getByTestId("fabric-path-hop")).toHaveCount(3);
    await expect(page.getByTestId("fabric-path-summary")).toContainText("2 hops: leaf1 → spine2 → leaf3");
    await page.getByTestId("fabric-lens-destination").fill("10.9.9.9");
    await page.getByTestId("fabric-lens-submit").click();
    await expect(page.getByTestId("fabric-path-failed")).toContainText("no-route on spine2");
  });

  test("a service shows its nodes, what disagrees, and issues first", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-lens-service");
    const broken = page.getByTestId("fabric-service-svc:macvrf-200");
    await expect(broken).toHaveAttribute("data-state", "mixed");
    await expect(broken).toContainText("VNI 200 has no remote VTEP");
    await page.getByTestId("fabric-service-svc:macvrf-100").getByRole("button", { expanded: false }).click();
    await expect(page.getByTestId("fabric-service-svc:macvrf-100").getByTitle("No other node of this service has it")).toHaveText("target:65000:999");
    await page.getByTestId("fabric-service-kind-ip-vrf").click();
    await expect(page.getByTestId("fabric-service-svc:ipvrf-1")).toBeVisible();
  });

  test("endpoints list every host", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-lens-endpoints");
    await expect(page.getByTestId("fabric-table").locator("tbody tr")).toHaveCount(2);
  });
});

test.describe("reports", () => {
  test("are grouped, and found by name or title", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-report-sys-info")).toBeVisible();
    await expect(page.getByTestId("fabric-report-bgp-rib-evpn")).toHaveCount(0);
    await page.getByTestId("fabric-report-find").fill("evpn type 2");
    await expect(page.getByTestId("fabric-report-bgp-rib-evpn-2")).toBeVisible();
    await expect(page.getByTestId("fabric-report-sys-info")).toHaveCount(0);
  });

  test("filter with the mini-syntax, by column and by row", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-bgp-peers");
    const rows = page.getByTestId("fabric-table").locator("tbody tr");
    await expect(rows).toHaveCount(6);
    await expect(page.getByTestId("fabric-report-source")).toHaveText("live");
    await page.getByLabel("Filter state").fill("!up");
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId("fabric-table-count")).toHaveText("2 of 6 rows");
    await page.getByLabel("Filter state").fill("");
    await page.getByLabel("Filter peer-as").fill(">65001");
    await expect(rows).toHaveCount(2);
    await page.getByRole("button", { name: "Clear filters" }).click();
    await expect(rows).toHaveCount(6);
    await page.getByTestId("fabric-table-filter").fill("spine2 up");
    await expect(rows).toHaveCount(1);
  });

  test("sort by a column, and cap a big table", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-ifstats");
    const rows = page.getByTestId("fabric-table").locator("tbody tr");
    await expect(page.getByTestId("fabric-table-count")).toHaveText("420 rows");
    await expect(rows).toHaveCount(300);
    await page.getByTestId("fabric-table-more").click();
    await expect(rows).toHaveCount(420);
    await page.getByRole("button", { name: "in-Kbps" }).click();
    await expect(rows.first().locator("td").nth(4)).toHaveText("0.0");
    await page.getByRole("button", { name: "in-Kbps" }).click();
    await expect(rows.first().locator("td").nth(4)).not.toHaveText("0.0");
  });

  test("draw route counts, whose numbers open the RIB form without reading it", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-bgp-peers");
    await page.getByRole("button", { name: "4", exact: true }).click();
    await expect(page.getByTestId("fabric-report")).toHaveAttribute("data-report", "bgp-rib-ipv4-unicast");
    await expect(page.getByTestId("fabric-param-neighbor")).toHaveValue("192.168.1.2");
    await expect(page.getByText("not read until you ask")).toBeVisible();
    expect((await calls(page)).some((call) => call.startsWith("GET reports/bgp-rib"))).toBe(false);
    await page.getByTestId("fabric-report-submit").click();
    await expect(page.getByTestId("fabric-report-source")).toHaveText("collected");
    expect((await calls(page)).some((call) => call.startsWith("GET reports/bgp-rib"))).toBe(true);
  });

  test("never read a BGP RIB on opening, until listed", async ({ page }) => {
    await open(page);
    await page.getByTestId("fabric-report-group-BGP RIB").click();
    await nav(page, "fabric-report-bgp-rib-evpn-2");
    await expect(page.getByText("not read until you ask")).toBeVisible();
    await expect(page.getByTestId("fabric-param-ni")).toHaveCount(0);
    expect((await calls(page)).some((call) => call.startsWith("GET reports/bgp-rib"))).toBe(false);
    await page.getByTestId("fabric-report-list-all").click();
    await expect(page.getByTestId("fabric-table")).toBeVisible();
    expect((await calls(page)).some((call) => call.includes("list_all=all"))).toBe(true);
  });

  test("with a parameter are collected on the spot", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-ipv4-rib");
    await page.getByTestId("fabric-param-address").fill("10.0.0.1");
    await page.getByTestId("fabric-report-submit").click();
    await expect(page.getByTestId("fabric-report-source")).toHaveText("collected");
  });

  test("list the nodes that could not answer", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-lag");
    await expect(page.getByRole("alert")).toContainText("leaf4: connection refused");
  });

  test("a commit has its diff against the one before", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-config-commits");
    await page.getByTestId("fabric-commit-diff-button").nth(1).click();
    await expect(page.getByTestId("fabric-commit-diff")).toContainText("leaf1, commit 3");
    await expect(page.getByTestId("fabric-config-diff-table")).toBeVisible();
  });
});

test.describe("live and the past", () => {
  test("refreshes about a second and a half after changes settle, once", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-report-bgp-peers");
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live");
    const count = async () => (await calls(page)).filter((call) => call === "GET reports/bgp-peers?table=1").length;
    await expect.poll(count).toBe(1);
    await page.evaluate(() => {
      for (let seq = 1; seq <= 5; seq += 1) {
        window.__FABRIC__.emit({ type: "change", seq, report: "bgp-peers", op: "change", node: "leaf1" });
      }
    });
    await page.waitForTimeout(300);
    expect(await count()).toBe(1);
    await expect.poll(count, { timeout: 5000 }).toBe(2);
  });

  test("the topology follows the fabric", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-topology-node-leaf2")).toHaveAttribute("data-health", "ok");
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live");
    await page.evaluate(() => {
      window.__FABRIC__.setNodeHealth("leaf2", "warning");
      window.__FABRIC__.emit({ type: "change", seq: 9, report: "subif", op: "change", node: "leaf2" });
    });
    await expect(page.getByTestId("fabric-topology-node-leaf2")).toHaveAttribute("data-health", "warning", { timeout: 5000 });
  });

  test("rates alone do not redraw the fabric", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live");
    const count = async () => (await calls(page)).filter((call) => call === "GET topology").length;
    const before = await count();
    await page.evaluate(() => window.__FABRIC__.emit({ type: "change", report: "ifstats", op: "update", node: "leaf2" }));
    await page.waitForTimeout(1900);
    expect(await count()).toBe(before);
  });

  test("a stream that ends comes back from the last change seen", async ({ page }) => {
    await open(page);
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live");
    await page.evaluate(() => {
      window.__FABRIC__.emit({ type: "change", seq: 42, report: "subif", op: "change", node: "leaf2" });
      window.__FABRIC__.closeStreams();
    });
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "reconnecting");
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live", { timeout: 5000 });
    expect(await calls(page)).toContain("events?after=42");
  });

  test("going back says so plainly, asks for that instant and stops following", async ({ page }) => {
    await open(page);
    await page.getByTestId("fabric-go-back").fill("soon");
    await page.getByTestId("fabric-go-back").press("Enter");
    await expect(page.getByTestId("fabric-past-banner")).toHaveCount(0);

    await page.getByTestId("fabric-go-back").fill("30m");
    await page.getByTestId("fabric-go-back").press("Enter");
    await expect(page.getByTestId("fabric-past-banner")).toContainText("as it was at");
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "paused");
    expect((await calls(page)).some((call) => /^GET topology\?at=\d/.test(call))).toBe(true);

    await nav(page, "fabric-report-bgp-peers");
    await expect(page.getByTestId("fabric-report-source")).toHaveText("history");

    await page.getByTestId("fabric-back-to-live").click();
    await expect(page.getByTestId("fabric-past-banner")).toHaveCount(0);
    await expect(page.getByTestId("fabric-connection")).toHaveAttribute("data-state", "live");
  });

  test("going back too far says why, and the way back still works", async ({ page }) => {
    await open(page);
    await page.getByTestId("fabric-go-back").fill("2d");
    await page.getByTestId("fabric-go-back").press("Enter");
    await expect(page.getByTestId("fabric-past-banner")).toContainText("The history starts");
    await page.getByTestId("fabric-back-to-live").click();
    await expect(page.getByTestId("fabric-topology")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("keeps its view for a page that was dropped", async ({ page }) => {
    await open(page);
    await nav(page, "fabric-nav-incidents");
    await expect(page.getByTestId("fabric-incidents")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("fabric-incidents")).toBeVisible();
  });
});

test.describe("narrow", () => {
  test.use({ viewport: { width: 620, height: 760 } });

  test("the navigation is a rail that opens over the page", async ({ page }) => {
    await open(page);
    const nav = page.getByTestId("fabric-nav");
    await expect(nav).toHaveCount(1);
    expect((await nav.boundingBox())?.width).toBeLessThan(60);
    await page.getByTestId("fabric-nav-reports").click();
    await expect(page.getByTestId("fabric-report-find")).toBeVisible();
    await page.getByTestId("fabric-report-bgp-peers").click();
    await expect(page.getByTestId("fabric-report-find")).toHaveCount(0);
    await expect(page.getByTestId("fabric-report")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
