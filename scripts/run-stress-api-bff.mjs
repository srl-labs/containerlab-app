#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const root = process.cwd();
const runId = process.env.STRESS_RUN_ID ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const resultsDir = path.resolve(process.env.STRESS_RESULTS_DIR ?? path.join("test-results", "stress", runId));
const apiUrl = trimSlash(process.env.API_URL ?? "https://127.0.0.1:8090");
const proxiedApiUrl = trimSlash(process.env.PROXIED_API_URL ?? "https://127.0.0.1:18090");
const appUrl = trimSlash(process.env.APP_URL ?? "http://127.0.0.1:3301");
const proxyControlUrl = trimSlash(process.env.PROXY_CONTROL_URL ?? "http://127.0.0.1:18091");
const globalTimeoutMs = Number.parseInt(process.env.STRESS_GLOBAL_TIMEOUT_MS ?? "900000", 10);
const users = parseUsers(process.env.STRESS_USERS ?? "test:test,clab:clab");

const children = new Set();
let failed = false;

function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseUsers(value) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(":");
      if (separator <= 0) {
        throw new Error(`Invalid STRESS_USERS entry "${entry}". Use username:password.`);
      }
      return {
        username: entry.slice(0, separator),
        password: entry.slice(separator + 1)
      };
    });
}

function slug(value, maxLength = 48) {
  const normalized = String(value)
    .replace(/[^a-zA-Z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return (normalized || "value").slice(0, maxLength);
}

function writeFile(name, content) {
  fs.writeFileSync(path.join(resultsDir, name), content);
}

function appendLine(name, line) {
  fs.appendFileSync(path.join(resultsDir, name), `${line}\n`);
}

function spawnLogged(name, command, args, options = {}) {
  const logPath = path.join(resultsDir, `${name}.log`);
  const log = fs.createWriteStream(logPath, { flags: "a" });
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", () => {
    children.delete(child);
    log.end();
  });
  return child;
}

function waitForExit(child, name) {
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      resolve({ name, code, signal });
    });
  });
}

async function waitForHttp(url, timeoutMs, expectedStatuses = [200]) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (expectedStatuses.includes(response.status)) {
        return;
      }
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = text;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

async function snapshot(name) {
  const snapshotData = {
    at: new Date().toISOString(),
    apiHealth: await fetchJson(`${apiUrl}/health`).catch((error) => ({ error: error.message })),
    appConfig: await fetchJson(`${appUrl}/api/config`).catch((error) => ({ error: error.message })),
    proxyStatus: await fetchJson(`${proxyControlUrl}/status`).catch((error) => ({ error: error.message })),
    stressContainers: await commandOutput("sudo", [
      "docker",
      "ps",
      "-a",
      "--filter",
      "name=stress-",
      "--format",
      "{{.Names}} {{.Status}}"
    ]),
    stressNetworks: await commandOutput("sudo", [
      "docker",
      "network",
      "ls",
      "--filter",
      "name=stress-",
      "--format",
      "{{.Name}}"
    ]),
    listeners: await commandOutput("sudo", ["ss", "-ltnp"])
  };
  writeFile(`${name}.json`, JSON.stringify(snapshotData, null, 2));
  return snapshotData;
}

function commandOutput(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("exit", (code, signal) => {
      resolve({ code, signal, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function outputLines(output) {
  return new Set(
    (output?.stdout ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
  );
}

function newLines(beforeOutput, afterOutput) {
  const before = outputLines(beforeOutput);
  return [...outputLines(afterOutput)].filter((line) => !before.has(line));
}

async function ensurePortFree(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(750) });
    throw new Error(`${url} is already serving traffic`);
  } catch (error) {
    if (error.name === "TimeoutError" || error.message.includes("fetch failed")) {
      return;
    }
    throw error;
  }
}

async function shutdown() {
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  }
  await delay(1500);
  for (const child of [...children].reverse()) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
}

async function main() {
  fs.mkdirSync(resultsDir, { recursive: true });
  writeFile(
    "metadata.json",
    JSON.stringify({ runId, apiUrl, proxiedApiUrl, appUrl, users: users.map(({ username }) => ({ username })) }, null, 2)
  );

  await waitForHttp(`${apiUrl}/health`, 15000);
  await ensurePortFree(appUrl);
  await ensurePortFree(proxiedApiUrl);
  await ensurePortFree(proxyControlUrl);

  const before = await snapshot("before");

  const proxyUrl = new URL(proxiedApiUrl);
  const proxyControl = new URL(proxyControlUrl);
  const api = new URL(apiUrl);
  const proxy = spawnLogged("impairment-proxy", "node", ["scripts/impairment-proxy.mjs"], {
    env: {
      PROXY_LISTEN_HOST: proxyUrl.hostname,
      PROXY_LISTEN_PORT: proxyUrl.port,
      PROXY_TARGET_HOST: api.hostname,
      PROXY_TARGET_PORT: api.port,
      PROXY_CONTROL_HOST: proxyControl.hostname,
      PROXY_CONTROL_PORT: proxyControl.port
    }
  });
  const proxyExit = waitForExit(proxy, "impairment-proxy");
  await waitForHttp(`${proxyControlUrl}/status`, 15000);

  const app = spawnLogged("app-server", "node_modules/.bin/tsx", ["apps/web/server/index.ts"], {
    env: {
      NODE_ENV: "development",
      WEB_TLS_ENABLE: "false",
      PORT: new URL(appUrl).port || "3301",
      CLAB_API_URL: proxiedApiUrl,
      CLAB_API_TLS_VERIFY: "false"
    }
  });
  const appExit = waitForExit(app, "app-server");
  await waitForHttp(`${appUrl}/api/config`, 60000);

  const timeout = setTimeout(() => {
    failed = true;
    appendLine("runner.log", `global timeout after ${globalTimeoutMs}ms`);
    shutdown().catch(() => {});
  }, globalTimeoutMs);

  const workerResults = await Promise.all(
    users.map(async (user) => {
      const name = `worker-${slug(user.username, 16)}`;
      const child = spawnLogged(name, "node", ["scripts/stress-api-bff.mjs"], {
        env: {
          APP_URL: appUrl,
          API_URL: apiUrl,
          PROXIED_API_URL: proxiedApiUrl,
          PROXY_CONTROL_URL: proxyControlUrl,
          STRESS_RUN_ID: runId,
          STRESS_USER: user.username,
          STRESS_PASS: user.password
        }
      });
      return await waitForExit(child, name);
    })
  );
  clearTimeout(timeout);

  for (const result of workerResults) {
    appendLine("runner.log", `${result.name} exited code=${result.code} signal=${result.signal ?? ""}`);
    if (result.code !== 0) {
      failed = true;
    }
  }

  await shutdown();
  const processResults = await Promise.all([proxyExit, appExit]);
  for (const result of processResults) {
    appendLine("runner.log", `${result.name} exited code=${result.code} signal=${result.signal ?? ""}`);
  }

  const after = await snapshot("after");
  const leftoverContainers = newLines(before.stressContainers, after.stressContainers);
  const leftoverNetworks = newLines(before.stressNetworks, after.stressNetworks);
  if (leftoverContainers.length > 0 || leftoverNetworks.length > 0) {
    failed = true;
    appendLine("runner.log", `new leftover stress containers: ${leftoverContainers.join(", ") || "<none>"}`);
    appendLine("runner.log", `new leftover stress networks: ${leftoverNetworks.join(", ") || "<none>"}`);
  }

  console.log(`stress results: ${resultsDir}`);
  process.exit(failed ? 1 : 0);
}

process.on("SIGINT", () => {
  failed = true;
  shutdown().finally(() => process.exit(130));
});
process.on("SIGTERM", () => {
  failed = true;
  shutdown().finally(() => process.exit(143));
});

main().catch(async (error) => {
  failed = true;
  try {
    appendLine("runner.log", `fatal: ${error instanceof Error ? error.stack : String(error)}`);
  } catch {
    // Ignore logging errors during early startup.
  }
  await shutdown();
  console.error(error);
  process.exit(1);
});
