#!/usr/bin/env node
import { setTimeout as delay } from "node:timers/promises";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const appUrl = trimSlash(process.env.APP_URL ?? "http://127.0.0.1:3301");
const directApiUrl = trimSlash(process.env.API_URL ?? "https://127.0.0.1:8090");
const proxiedApiUrl = trimSlash(process.env.PROXIED_API_URL ?? "https://127.0.0.1:18090");
const proxyControlUrl = trimSlash(process.env.PROXY_CONTROL_URL ?? "http://127.0.0.1:18091");
const username = process.env.STRESS_USER ?? "test";
const password = process.env.STRESS_PASS ?? "test";
const runId = process.env.STRESS_RUN_ID ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const iterations = Number.parseInt(process.env.STRESS_ITERATIONS ?? "2", 10);
const eventStreams = Number.parseInt(process.env.STRESS_EVENT_STREAMS ?? "10", 10);
const inspectBursts = Number.parseInt(process.env.STRESS_INSPECT_BURSTS ?? "30", 10);
const impairmentEnabled = process.env.STRESS_IMPAIRMENT !== "0";
const userSlug = slug(username, 12);

const summary = {
  runId,
  username,
  appUrl,
  directApiUrl,
  proxiedApiUrl,
  counters: {
    ok: 0,
    tolerated: 0,
    failed: 0,
    plannedAborts: 0
  },
  labs: [],
  failures: []
};

let cookie = "";
let endpointId = "";
let directToken = "";

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function slug(value, maxLength = 48) {
  const normalized = String(value)
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return (normalized || "user").slice(0, maxLength);
}

function topologyYaml(labName) {
  return `name: ${labName}
topology:
  kinds:
    linux:
      image: ghcr.io/srl-labs/network-multitool:latest
  nodes:
    srl1:
      kind: linux
    srl2:
      kind: linux
  links:
    - endpoints:
        - srl1:eth1
        - srl2:eth1
`;
}

function recordFailure(name, error, tolerated = false) {
  const message = error instanceof Error ? error.message : String(error);
  const effectiveTolerance = tolerated && isExpectedConnectivityFailure(message);
  summary.failures.push({ name, tolerated: effectiveTolerance, message });
  if (effectiveTolerance) {
    summary.counters.tolerated += 1;
  } else {
    summary.counters.failed += 1;
  }
}

function isExpectedConnectivityFailure(message) {
  return (
    message.includes("AbortError") ||
    message.includes("This operation was aborted") ||
    message.includes("The operation was aborted") ||
    message.includes("context canceled") ||
    message.includes("context cancelled") ||
    message.includes("returned 502") ||
    message.includes("Unable to connect to clab-api-server") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("UND_ERR_SOCKET") ||
    message.includes("fetch failed") ||
    message.includes("socket hang up") ||
    message.includes("other side closed")
  );
}

function rememberCookies(headers) {
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie")]
        : [];
  if (setCookies.length === 0) return;

  const next = setCookies
    .map((value) => value.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  if (next) {
    cookie = next;
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: options.signal ?? controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(baseUrl, path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(cookie && baseUrl === appUrl ? { Cookie: cookie } : {}),
    ...(options.headers ?? {})
  };
  const started = Date.now();
  const response = await fetchWithTimeout(
    `${baseUrl}${path}`,
    {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    },
    options.timeoutMs ?? 30000
  );
  rememberCookies(response.headers);
  const text = await response.text();
  let payload = undefined;
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  const okStatuses = options.okStatuses ?? [200];
  if (!okStatuses.includes(response.status)) {
    throw new Error(`${options.method ?? "GET"} ${path} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  summary.counters.ok += 1;
  return { status: response.status, payload, durationMs: Date.now() - started };
}

async function setProxyProfile(profile) {
  const selectedProfile = impairmentEnabled ? profile : "clean";
  const response = await fetchWithTimeout(
    `${proxyControlUrl}/profile`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profile: selectedProfile })
    },
    10000
  );
  if (!response.ok) {
    throw new Error(`set proxy profile ${selectedProfile} failed: ${response.status} ${await response.text()}`);
  }
  console.log(`proxy profile: ${selectedProfile}`);
}

async function getProxyStatus() {
  const response = await fetchWithTimeout(`${proxyControlUrl}/status`, {}, 10000);
  if (!response.ok) {
    throw new Error(`proxy status failed: ${response.status}`);
  }
  return await response.json();
}

async function loginThroughApp() {
  const result = await requestJson(appUrl, "/auth/login", {
    method: "POST",
    timeoutMs: 45000,
    body: {
      url: proxiedApiUrl,
      username,
      password,
      sessionDuration: "1h"
    }
  });
  endpointId = result.payload?.endpoint?.id;
  if (!endpointId) {
    throw new Error(`login response did not include endpoint id: ${JSON.stringify(result.payload)}`);
  }
  console.log(`logged in through app as ${username}; endpoint=${endpointId}`);
}

async function directLogin() {
  const result = await requestJson(directApiUrl, "/login", {
    method: "POST",
    timeoutMs: 15000,
    body: { username, password }
  });
  directToken = result.payload?.token;
  if (!directToken) {
    throw new Error("direct API login did not return a token");
  }
}

async function createTopology(baseLabName) {
  let lastError = undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const labName = attempt === 0 ? baseLabName : `${baseLabName}-r${attempt}`;
    try {
      const result = await requestJson(appUrl, "/api/runtime/topology-file/create", {
        method: "POST",
        timeoutMs: 45000,
        body: {
          endpointId,
          fileName: `${labName}.clab.yml`,
          content: topologyYaml(labName)
        }
      });
      if (!result.payload?.topologyRef) {
        throw new Error(`create topology did not return topologyRef: ${JSON.stringify(result.payload)}`);
      }
      summary.labs.push(labName);
      return { labName, topologyRef: result.payload.topologyRef };
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!isExpectedConnectivityFailure(message) || attempt === 4) {
        throw error;
      }
      recordFailure(`create-topology-retry-${labName}`, error, true);
      await setProxyProfile("clean").catch(() => {});
      await delay(500 * (attempt + 1));
    }
  }

  throw lastError ?? new Error(`failed to create topology for ${baseLabName}`);
}

async function appPost(path, body, timeoutMs = 30000, okStatuses = [200]) {
  return await requestJson(appUrl, path, {
    method: "POST",
    timeoutMs,
    okStatuses,
    body: { endpointId, ...body }
  });
}

async function appGet(path, timeoutMs = 15000, okStatuses = [200]) {
  return await requestJson(appUrl, path, { timeoutMs, okStatuses });
}

async function readAppStream(path, options) {
  const controller = new AbortController();
  let plannedAbort = false;
  let bytes = 0;
  let reader;
  const timer = setTimeout(() => {
    plannedAbort = true;
    controller.abort();
  }, options.cancelAfterMs);

  try {
    const response = await fetch(`${appUrl}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Accept: options.accept ?? "*/*",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(options.body ? { "Content-Type": "application/json" } : {})
      },
      body: options.body ? JSON.stringify({ endpointId, ...options.body }) : undefined,
      signal: controller.signal
    });
    rememberCookies(response.headers);
    if (!response.ok) {
      throw new Error(`${options.method ?? "GET"} ${path} stream returned ${response.status}: ${await response.text()}`);
    }
    if (!response.body) {
      throw new Error(`${path} did not return a stream body`);
    }
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.length ?? 0;
      if (bytes > (options.maxBytes ?? 256000)) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
    summary.counters.ok += 1;
    return { bytes, plannedAbort: false };
  } catch (error) {
    if (plannedAbort && error?.name === "AbortError") {
      summary.counters.plannedAborts += 1;
      return { bytes, plannedAbort: true };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (reader) {
      await reader.cancel().catch(() => {});
    }
  }
}

async function lifecycleStream(action, topologyRef, cancelAfterMs) {
  return await readAppStream(`/api/lab/${action}/stream`, {
    method: "POST",
    accept: "application/x-ndjson",
    cancelAfterMs,
    body: {
      topologyRef,
      cleanup: true
    }
  });
}

async function lifecycleJson(action, topologyRef, timeoutMs = 240000, okStatuses = [200]) {
  return await appPost(`/api/lab/${action}`, { topologyRef, cleanup: true }, timeoutMs, okStatuses);
}

async function runEventStreams() {
  const tasks = Array.from({ length: eventStreams }, (_, index) =>
    readAppStream("/api/events", {
      method: "GET",
      accept: "text/event-stream",
      cancelAfterMs: 400 + Math.floor(Math.random() * 1800),
      maxBytes: 128000
    }).catch((error) => recordFailure(`event-stream-${index}`, error, true))
  );
  await Promise.all(tasks);
}

async function runInspectBursts() {
  const tasks = [];
  for (let index = 0; index < inspectBursts; index += 1) {
    tasks.push(
      appGet(`/api/runtime/inspect/all?endpointId=${encodeURIComponent(endpointId)}`, 12000)
        .catch((error) => recordFailure(`inspect-${index}`, error, true))
    );
    await delay(50);
  }
  await Promise.all(tasks);
}

async function exerciseNetem(topologyRef) {
  await appPost("/api/runtime/netem/set", {
    topologyRef,
    nodeName: "srl1",
    interfaceName: "eth1",
    delay: "25ms",
    loss: 0.5
  }, 60000);
  await appPost("/api/runtime/netem/show", {
    topologyRef,
    nodeName: "srl1"
  }, 30000);
  await appPost("/api/runtime/netem/reset", {
    topologyRef,
    nodeName: "srl1",
    interfaceName: "eth1"
  }, 60000);
}

async function cleanupLab(labName) {
  if (!directToken) return;
  const response = await fetchWithTimeout(
    `${directApiUrl}/api/v1/labs/${encodeURIComponent(labName)}?cleanup=true`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${directToken}` }
    },
    180000
  );
  const text = await response.text().catch(() => "");
  if (![200, 404].includes(response.status)) {
    recordFailure(`cleanup-${labName}`, new Error(`cleanup returned ${response.status}: ${text}`), true);
  }
}

async function main() {
  console.log(`stress run ${runId}`);
  await setProxyProfile("clean");
  await requestJson(appUrl, "/api/config", { timeoutMs: 10000 });
  await loginThroughApp();
  await directLogin();

  const labRefs = [];
  for (let index = 0; index < iterations; index += 1) {
    const labName = slug(`stress-${userSlug}-${runId}-${index}`, 48);
    labRefs.push(await createTopology(labName));
  }

  await setProxyProfile("delay");
  await Promise.all([runEventStreams(), runInspectBursts()]);

  for (const { labName, topologyRef } of labRefs) {
    console.log(`cancel deploy stream for ${labName}`);
    await setProxyProfile("flaky");
    await lifecycleStream("deploy", topologyRef, 1200).catch((error) =>
      recordFailure(`deploy-stream-cancel-${labName}`, error, true)
    );
    await delay(3000);

    console.log(`deploy ${labName} to completion`);
    await setProxyProfile("clean");
    await lifecycleJson("destroy", topologyRef, 120000, [200, 404]).catch((error) =>
      recordFailure(`pre-clean-${labName}`, error, true)
    );
    await lifecycleJson("deploy", topologyRef, 240000);

    await setProxyProfile("delay");
    await Promise.all([
      runEventStreams(),
      exerciseNetem(topologyRef).catch((error) => recordFailure(`netem-${labName}`, error, true)),
      lifecycleStream("restart", topologyRef, 1800).catch((error) =>
        recordFailure(`restart-stream-cancel-${labName}`, error, true)
      )
    ]);

    console.log(`destroy stream under hostile profile for ${labName}`);
    await setProxyProfile("hostile");
    await lifecycleStream("destroy", topologyRef, 1500).catch((error) =>
      recordFailure(`destroy-stream-cancel-${labName}`, error, true)
    );

    await setProxyProfile("clean");
    await lifecycleJson("destroy", topologyRef, 240000, [200, 404]).catch((error) =>
      recordFailure(`final-destroy-${labName}`, error, true)
    );
  }

  await setProxyProfile("clean");
  for (const labName of summary.labs) {
    await cleanupLab(labName);
  }

  summary.proxyStatus = await getProxyStatus().catch((error) => ({ error: error.message }));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.counters.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  recordFailure("fatal", error, false);
  await setProxyProfile("clean").catch(() => {});
  await directLogin().catch(() => {});
  for (const labName of summary.labs) {
    await cleanupLab(labName).catch(() => {});
  }
  summary.proxyStatus = await getProxyStatus().catch((statusError) => ({ error: statusError.message }));
  console.error(JSON.stringify(summary, null, 2));
  process.exit(summary.counters.failed > 0 ? 1 : 0);
});
