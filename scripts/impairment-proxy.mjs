#!/usr/bin/env node
import http from "node:http";
import net from "node:net";

const listenHost = process.env.PROXY_LISTEN_HOST ?? "127.0.0.1";
const listenPort = Number.parseInt(process.env.PROXY_LISTEN_PORT ?? "18090", 10);
const targetHost = process.env.PROXY_TARGET_HOST ?? "127.0.0.1";
const targetPort = Number.parseInt(process.env.PROXY_TARGET_PORT ?? "8090", 10);
const controlHost = process.env.PROXY_CONTROL_HOST ?? "127.0.0.1";
const controlPort = Number.parseInt(process.env.PROXY_CONTROL_PORT ?? "18091", 10);
const verbose = process.env.PROXY_VERBOSE === "1";

const profiles = {
  clean: {
    minDelayMs: 0,
    maxDelayMs: 0,
    resetOnConnectRate: 0,
    resetDuringChunkRate: 0,
    maxLifetimeMs: 0
  },
  delay: {
    minDelayMs: 40,
    maxDelayMs: 180,
    resetOnConnectRate: 0,
    resetDuringChunkRate: 0.001,
    maxLifetimeMs: 0
  },
  flaky: {
    minDelayMs: 100,
    maxDelayMs: 500,
    resetOnConnectRate: 0.02,
    resetDuringChunkRate: 0.01,
    maxLifetimeMs: 15000
  },
  hostile: {
    minDelayMs: 250,
    maxDelayMs: 1200,
    resetOnConnectRate: 0.08,
    resetDuringChunkRate: 0.025,
    maxLifetimeMs: 6000
  }
};

const metrics = {
  accepted: 0,
  active: 0,
  bytesClientToTarget: 0,
  bytesTargetToClient: 0,
  connectResets: 0,
  chunkResets: 0,
  lifetimeResets: 0,
  targetErrors: 0
};

let currentProfile = profiles[process.env.PROXY_PROFILE] ? process.env.PROXY_PROFILE : "clean";
const openSockets = new Set();

function profile() {
  return profiles[currentProfile];
}

function randomDelayMs(config) {
  if (config.maxDelayMs <= 0) return 0;
  return Math.floor(config.minDelayMs + Math.random() * (config.maxDelayMs - config.minDelayMs + 1));
}

function log(...args) {
  if (verbose) {
    console.log(new Date().toISOString(), ...args);
  }
}

function destroyPair(left, right) {
  left.destroy();
  right.destroy();
}

function bridge(source, destination, direction, connectionId) {
  source.on("data", (chunk) => {
    const config = profile();
    if (Math.random() < config.resetDuringChunkRate) {
      metrics.chunkResets += 1;
      log(connectionId, direction, "reset during chunk");
      destroyPair(source, destination);
      return;
    }

    if (direction === "client->target") {
      metrics.bytesClientToTarget += chunk.length;
    } else {
      metrics.bytesTargetToClient += chunk.length;
    }

    const delayMs = randomDelayMs(config);
    if (delayMs > 0) {
      setTimeout(() => {
        if (!destination.destroyed) {
          destination.write(chunk);
        }
      }, delayMs);
      return;
    }

    if (!destination.destroyed) {
      destination.write(chunk);
    }
  });
}

const tcpServer = net.createServer((clientSocket) => {
  const connectionId = ++metrics.accepted;
  metrics.active += 1;
  const started = Date.now();
  const config = profile();
  log(connectionId, "accepted", currentProfile);
  openSockets.add(clientSocket);
  clientSocket.on("close", () => openSockets.delete(clientSocket));

  let closed = false;
  const markClosed = () => {
    if (closed) return;
    closed = true;
    metrics.active -= 1;
    log(connectionId, "closed after", `${Date.now() - started}ms`);
  };

  if (Math.random() < config.resetOnConnectRate) {
    metrics.connectResets += 1;
    clientSocket.destroy();
    markClosed();
    return;
  }

  const targetSocket = net.createConnection({ host: targetHost, port: targetPort });
  openSockets.add(targetSocket);
  targetSocket.on("close", () => openSockets.delete(targetSocket));
  clientSocket.on("close", markClosed);
  targetSocket.on("close", () => clientSocket.destroy());
  clientSocket.on("error", () => targetSocket.destroy());
  targetSocket.on("error", (error) => {
    metrics.targetErrors += 1;
    log(connectionId, "target error", error.message);
    clientSocket.destroy();
  });

  targetSocket.on("connect", () => {
    bridge(clientSocket, targetSocket, "client->target", connectionId);
    bridge(targetSocket, clientSocket, "target->client", connectionId);
  });

  if (config.maxLifetimeMs > 0) {
    const lifetime = Math.floor(config.maxLifetimeMs * (0.5 + Math.random()));
    setTimeout(() => {
      if (!clientSocket.destroyed || !targetSocket.destroyed) {
        metrics.lifetimeResets += 1;
        log(connectionId, "lifetime reset", `${lifetime}ms`);
        destroyPair(clientSocket, targetSocket);
      }
    }, lifetime).unref();
  }
});

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  response.end(body);
}

const controlServer = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${controlHost}:${controlPort}`}`);
  if (request.method === "GET" && url.pathname === "/status") {
    writeJson(response, 200, {
      profile: currentProfile,
      profiles: Object.keys(profiles),
      target: `${targetHost}:${targetPort}`,
      metrics
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/profile") {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      let requestedProfile = url.searchParams.get("name") ?? "";
      if (!requestedProfile && body.trim()) {
        try {
          const parsed = JSON.parse(body);
          requestedProfile = typeof parsed.profile === "string" ? parsed.profile : "";
        } catch {
          requestedProfile = "";
        }
      }

      if (!profiles[requestedProfile]) {
        writeJson(response, 400, { error: "unknown profile", profiles: Object.keys(profiles) });
        return;
      }

      currentProfile = requestedProfile;
      writeJson(response, 200, { profile: currentProfile, metrics });
    });
    return;
  }

  writeJson(response, 404, { error: "not found" });
});

tcpServer.listen(listenPort, listenHost, () => {
  console.log(`impairment proxy listening on ${listenHost}:${listenPort} -> ${targetHost}:${targetPort}`);
});

controlServer.listen(controlPort, controlHost, () => {
  console.log(`impairment proxy control listening on http://${controlHost}:${controlPort}`);
});

function shutdown() {
  tcpServer.close();
  controlServer.close();
  for (const socket of openSockets) {
    socket.destroy();
  }
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
