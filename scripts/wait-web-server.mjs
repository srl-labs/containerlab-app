const port = process.env.PORT || "3001";
const tlsEnabled = !["0", "false", "no", "off"].includes(
  (process.env.WEB_TLS_ENABLE || "true").trim().toLowerCase()
);
const protocol = tlsEnabled ? "https" : "http";
const url = `${protocol}://localhost:${port}/api/config`;
const deadline = Date.now() + 30_000;

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

while (Date.now() < deadline) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      process.exit(0);
    }
  } catch {
    // Keep polling until the server is ready or the deadline expires.
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}

console.error(`Timed out waiting for ${url}`);
process.exit(1);
