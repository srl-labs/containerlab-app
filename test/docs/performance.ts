import { expect, test } from "@playwright/test";

for (const cpuSlowdown of [1, 4]) {
test(`cold documentation viewer is painted in under one second (${cpuSlowdown}x CPU)`, async ({ browser }, testInfo) => {
  const measurements = [];
  for (let run = 0; run < 3; run++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      // Each context starts with an empty cache. Keep within-page preload reuse enabled,
      // as it is for a real first-time visitor to the production site.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false, latency: 40,
        downloadThroughput: 10 * 1024 * 1024 / 8,
        uploadThroughput: 1024 * 1024 / 8
      });
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuSlowdown });
      await page.addInitScript(() => {
        document.addEventListener("clab:loaded", event => {
          const timing = (event as CustomEvent<{ duration: number }>).detail;
          document.documentElement.dataset.viewerDuration = String(timing.duration);
          document.documentElement.dataset.viewerPageDuration = String(performance.now());
        }, { once: true });
      });
      await page.goto(String(testInfo.project.use.baseURL));
      await expect(page.locator("clab-topology")).toHaveAttribute("data-loaded", "true");
      const frame = page.frames().find(frame => frame.url().includes("viewer.html"))!;
      await expect(frame.locator(".react-flow__node-topology-node")).toHaveCount(8);
      const timing = await page.evaluate(() => ({
        viewerMs: Number(document.documentElement.dataset.viewerDuration),
        pageMs: Number(document.documentElement.dataset.viewerPageDuration)
      }));
      const resources = await frame.evaluate(() => performance.getEntriesByType("resource").map(entry => ({
        name: entry.name.split("/").pop(),
        decodedBytes: (entry as PerformanceResourceTiming).decodedBodySize,
        transferredBytes: (entry as PerformanceResourceTiming).encodedBodySize
      })));
      measurements.push({ ...timing, resources });
      expect(timing.viewerMs, `cold viewer run ${run + 1}`).toBeLessThan(1000);
      if (cpuSlowdown === 1) expect(timing.pageMs, `cold page and viewer run ${run + 1}`).toBeLessThan(1000);
      expect(resources.reduce((sum, resource) => sum + resource.transferredBytes, 0)).toBeLessThan(250_000);
      expect(resources.some(resource => /monaco|maplibre|markdownRenderer|TrafficChart/i.test(resource.name ?? ""))).toBe(false);
    } finally {
      await context.close();
    }
  }
  await testInfo.attach("cold-viewer-timings", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
  console.log(`Cold viewer, 10 Mbps / 40 ms latency / ${cpuSlowdown}x CPU:`, measurements.map(({ viewerMs, pageMs }) => ({ viewerMs, pageMs })));
});
}
