import { expect, test } from "@srl-labs/containerlab-test-kit/playwright";

test("a Wireshark window of two sessions closes both with one request as it goes away", async ({ page }) => {
  const closeRequests: URL[] = [];
  await page.route("**/api/runtime/capture/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/ready")) {
      await route.fulfill({ json: { ready: true, url: url.pathname.replace(/ready$/, "vnc/") } });
    } else if (url.pathname.includes("/vnc/")) {
      await route.fulfill({ contentType: "text/html", body: "<p>Mock Wireshark viewer</p>" });
    } else {
      if (route.request().method() === "POST" || route.request().method() === "DELETE") closeRequests.push(url);
      await route.fulfill({ json: { success: true } });
    }
  });

  await page.goto("wireshark.html?sessionId=capture-a&sessionId=capture-b&label=n1%3Aeth1&label=n2%3Aeth1&endpointId=endpoint-1");
  for (const index of [0, 1]) {
    const viewer = page.frameLocator("iframe").nth(index).frameLocator("iframe").getByText("Mock Wireshark viewer");
    await expect(viewer).toBeAttached();
  }

  // Closing the window hides the page and each of its frames. As a browser quits, the requests of
  // only some frames may still go out, so the window alone closes the sessions, with one request.
  for (const frame of page.frames()) {
    await frame.evaluate(() => window.dispatchEvent(new Event("pagehide"))).catch(() => {});
  }
  await expect.poll(() => closeRequests.length).toBe(1);
  await page.waitForTimeout(300);
  expect(closeRequests).toHaveLength(1);
  expect(closeRequests[0].pathname).toBe("/api/runtime/capture/wireshark-vnc-sessions/close");
  expect(closeRequests[0].searchParams.getAll("sessionId")).toEqual(["capture-a", "capture-b"]);
  expect(closeRequests[0].searchParams.get("endpointId")).toBe("endpoint-1");
});
