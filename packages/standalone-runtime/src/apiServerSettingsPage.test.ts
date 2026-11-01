// An API Server's settings page, from what clab-api-server answers on
// GET /api/v1/lab-host, through the lab backend and the lab host list, as the
// web and desktop apps show it: every row has the server's value, or is greyed
// out with why it does not apply.
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test, { type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { labHostProfileDetails } from "@containerlab/clab-ui/host";
import { LabHostSettingsPage, labHostSettingsSubject } from "@containerlab/clab-ui/settings";
import { ApiLabBackend, clearServerFeatureCache } from "@srl-labs/containerlab-lab-backend/api";

import type { EndpointConfig } from "./stores/endpointStore";

/** `GET /api/v1/lab-host` as clab-api-server answers it with its defaults. */
const LAB_HOSTS = {
  docker: {
    runtime: "docker",
    defaultTimeout: "5m",
    capture: {
      wiresharkVnc: true,
      wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
      wiresharkPullPolicy: "always",
      edgeshark: { packetflixPort: 5001, extraEnvVars: ["HTTP_PROXY", "NO_PROXY"] }
    }
  },
  c9s: {
    runtime: "c9s",
    defaultTimeout: "10m",
    capture: {
      wiresharkVnc: true,
      wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
      wiresharkPullPolicy: "always"
    },
    c9s: {
      context: "c9s-provisioner",
      cluster: "c9s",
      namespacePattern: "c9s-c9sdemo-{lab}",
      sharedNamespacePattern: "c9s-shared-{lab}",
      exposeType: "None",
      persistence: true,
      imagePullSecret: "",
      labQuota: false,
      noTopologyCR: false,
      metrics: true
    }
  }
} as const;

type Runtime = keyof typeof LAB_HOSTS;

async function serve(t: TestContext, runtime: Runtime): Promise<string> {
  const server = http.createServer((request, response) => {
    const send = (body: unknown) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.url === "/health") {
      send({ status: "healthy", runtime, namespaceMode: runtime === "c9s" ? "per-lab" : undefined, features: ["lab-host-info", "lab-lifecycle-timeout"] });
    } else if (request.url === "/api/v1/lab-host" && request.headers.authorization === "Bearer token") {
      send(LAB_HOSTS[runtime]);
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** The API Server's page as the apps render it, for an endpoint as the lab host list has it. */
function renderPage(endpoint: EndpointConfig): string {
  return renderToStaticMarkup(
    createElement(LabHostSettingsPage, {
      subject: labHostSettingsSubject(endpoint),
      rows: {},
      onChange: () => Promise.resolve()
    })
  );
}

/** Each row of the page with how it shows and its read-only value. */
function rowsOf(html: string): Map<string, { access: string; value?: string; missing: boolean }> {
  const rows = new Map<string, { access: string; value?: string; missing: boolean }>();
  const parts = html.split(/(?=<div[^>]*data-testid="lab-host-setting-[a-zA-Z]+")/);
  for (const part of parts) {
    const head = /^<div[^>]*data-testid="lab-host-setting-([a-zA-Z]+)"[^>]*data-access="([a-z]+)"/.exec(part);
    if (!head) continue;
    // Short values are an input, long ones a textarea that wraps (MUI adds a hidden one to measure).
    const value =
      /<input[^>]*value="([^"]*)"/.exec(part)?.[1] ??
      /<textarea(?![^>]*aria-hidden)[^>]*>([^<]*)<\/textarea>/.exec(part)?.[1];
    rows.set(head[1], { access: head[2], ...(value !== undefined ? { value } : {}), missing: part.includes('data-value="missing"') });
  }
  return rows;
}

async function apiServerEndpoint(t: TestContext, runtime: Runtime): Promise<EndpointConfig> {
  clearServerFeatureCache();
  const url = await serve(t, runtime);
  const profile = await new ApiLabBackend({ baseUrl: url, token: "token" }).hostProfile();
  return {
    id: `api-${runtime}`,
    kind: "api",
    url,
    label: `${runtime} server`,
    username: "c9sdemo",
    sessionDuration: "24h",
    status: "connected",
    connected: true,
    ...labHostProfileDetails(profile)
  };
}

test("a c9s API Server's page shows every value it reports, Topology resource and Wireshark VNC included", async (t) => {
  const html = renderPage(await apiServerEndpoint(t, "c9s"));
  assert.doesNotMatch(html, /Not reported/);
  const rows = rowsOf(html);
  const values = Object.fromEntries([...rows].filter(([, row]) => row.access === "server").map(([id, row]) => [id, row.value]));
  assert.deepEqual(values, {
    runtime: "Kubernetes (c9s)",
    kubeconfig: "c9s",
    namespaces: "c9s-c9sdemo-{lab}",
    timeout: "10m",
    exposeType: "None",
    persistence: "On",
    imagePullSecret: "None",
    noTopologyCR: "Off",
    wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
    wiresharkPullPolicy: "Always"
  });
  for (const id of ["socket", "binaryPath", "deployArgs", "destroyArgs", "vncHostname", "edgeshark", "captureHostname", "packetflixPort", "edgesharkEnv"]) {
    assert.equal(rows.get(id)?.access, "unsupported", id);
  }
  assert.ok([...rows.values()].every((row) => !row.missing));
});

test("a Docker API Server's page shows every value it reports, Edgeshark's included", async (t) => {
  const html = renderPage(await apiServerEndpoint(t, "docker"));
  assert.doesNotMatch(html, /Not reported/);
  const rows = rowsOf(html);
  const values = Object.fromEntries([...rows].filter(([, row]) => row.access === "server").map(([id, row]) => [id, row.value]));
  assert.deepEqual(values, {
    runtime: "Docker",
    timeout: "5m",
    wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
    wiresharkPullPolicy: "Always",
    packetflixPort: "5001",
    edgesharkEnv: "HTTP_PROXY, NO_PROXY (values not shown)"
  });
  for (const id of ["kubeconfig", "namespaces", "exposeType", "persistence", "imagePullSecret", "noTopologyCR", "vncHostname"]) {
    assert.equal(rows.get(id)?.access, "unsupported", id);
  }
  assert.ok([...rows.values()].every((row) => !row.missing));
});

test("a signed-out API Server's page says to sign in instead of inventing values", () => {
  const html = renderPage({
    id: "api-saved",
    kind: "api",
    url: "http://lab:8090",
    label: "lab",
    username: "c9sdemo",
    sessionDuration: "24h",
    status: "saved",
    connected: false
  });
  assert.doesNotMatch(html, /Not reported/);
  assert.match(html, /Sign in to see what it sets\./);
  const rows = rowsOf(html);
  assert.ok([...rows.values()].filter((row) => row.access === "server").every((row) => row.missing && row.value === undefined));
});
