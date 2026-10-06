// Renders the secondary webviews (image manager, inspect, welcome, impairments, Wireshark) with fixture data.
import Box from "@mui/material/Box";
import React from "react";
import { createRoot } from "react-dom/client";

import {
  ClabUiRuntimeProvider,
  createClabUiRuntime,
  createWindowClabUiHost,
  type ClabUiImageHost
} from "../../src/host";
import { ContainerlabImageManagerDialog, ImageManagerApp } from "../../src/image-manager";
import type { ContainerImageSummary, KindImageReference } from "../../src/image-manager";
import { InspectApp } from "../../src/inspect";
import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import { APP_THEMES, applyAppTheme, resolveAppTheme } from "../../src/theme/appThemes";
import { NodeImpairmentsApp } from "../../src/webviews/nodeImpairments/nodeImpairments.webview";
import { WelcomePageApp } from "../../src/webviews/welcome/welcomePage.webview";
import { WiresharkVncApp } from "../../src/webviews/wiresharkVnc/wiresharkVnc.webview";

const params = new URLSearchParams(location.search);
const view = params.get("view") ?? "image-manager";
const state = params.get("state") ?? "ready";
const themeId = params.get("theme") ?? "dark-modern";
const mode = APP_THEMES.find((theme) => theme.id === themeId)?.mode ?? "dark";
applyAppTheme(resolveAppTheme(mode, themeId));
document.body.classList.add(mode === "light" ? "vscode-light" : "vscode-dark");
Object.assign(window, {
  __CLAB_APPEARANCE__: { colorScheme: "vscode", fontSize: 0, fontFamily: "", reduceMotion: true }
});

const image = (tag: string, size: string, createdAt: string): ContainerImageSummary => ({
  id: `sha256:${tag.length.toString(16)}${tag.replace(/\W/g, "").slice(0, 10)}`,
  repoTags: [tag],
  repoDigests: [],
  size,
  createdAt
});
const IMAGES: ContainerImageSummary[] = [
  image("ghcr.io/nokia/srlinux:24.10.1", "2.1 GB", "3 weeks ago"),
  image("ghcr.io/nokia/srlinux:latest", "2.1 GB", "3 weeks ago"),
  image("ceos:4.32.0F", "2.4 GB", "2 months ago"),
  image("ghcr.io/srl-labs/network-multitool:latest", "112 MB", "5 days ago"),
  image("alpine:3.20", "7.8 MB", "4 months ago"),
  image("nginx:1.27", "188 MB", "1 month ago")
];
const REFERENCES: KindImageReference[] = [
  {
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    source: "topology-kind",
    label: "demo.clab.yml"
  },
  {
    kind: "arista_ceos",
    image: "ceos:4.33.1F",
    source: "topology-node",
    label: "dc.clab.yml · leaf1"
  },
  {
    kind: "linux",
    image: "ghcr.io/srl-labs/network-multitool:latest",
    source: "topology-node",
    label: "demo.clab.yml · client1"
  },
  {
    kind: "nokia_sros",
    image: "vrnetlab/nokia_sros:<version>",
    source: "topology-kind",
    label: "sros.clab.yml"
  }
];
const images: ClabUiImageHost = {
  async listImages() {
    if (state === "loading") await new Promise(() => undefined);
    if (state === "error")
      throw new Error("Could not reach the selected endpoint. Connect it to load images.");
    return state === "empty" ? [] : IMAGES;
  },
  async listImageReferences() {
    return state === "empty" ? [] : REFERENCES;
  },
  async pullImage(request) {
    return { success: true, message: `Pulled ${request.image}.` };
  },
  async removeImage(request) {
    return { success: true, message: `Removed ${request.reference}.` };
  }
};
const runtime = createClabUiRuntime({
  host: createWindowClabUiHost({ images, postMessage: () => undefined })
});

const container = (
  name: string,
  lab: string,
  kind: string,
  img: string,
  ipv4: string,
  extra: object = {}
) => ({
  name: `clab-${lab}-${name}`,
  lab_name: lab,
  kind,
  image: img,
  state: "running",
  status: "Up 2 hours",
  ipv4_address: ipv4,
  ipv6_address: `3fff:172:20:20::${ipv4.split(".").pop()}/64`,
  network_name: "clab",
  ID: `${name}0123456789ab`,
  Pid: 4000 + ipv4.length * 13 + name.length,
  Labels: { "clab-owner": "admin" },
  ...extra
});

function setupInitialData(): void {
  const win = window as unknown as { __INITIAL_DATA__?: unknown };
  if (view === "inspect") {
    win.__INITIAL_DATA__ = {
      containers:
        state === "empty"
          ? []
          : [
              container(
                "spine1",
                "demo",
                "nokia_srlinux",
                "ghcr.io/nokia/srlinux:24.10.1",
                "172.20.20.2/24",
                {
                  node_type: "ixrd3l",
                  Ports: [
                    { port: 57400, protocol: "tcp" },
                    { port: 443, protocol: "tcp" }
                  ]
                }
              ),
              container(
                "leaf1",
                "demo",
                "nokia_srlinux",
                "ghcr.io/nokia/srlinux:24.10.1",
                "172.20.20.3/24",
                { node_type: "ixrd2l" }
              ),
              container(
                "client1",
                "demo",
                "linux",
                "ghcr.io/srl-labs/network-multitool:latest",
                "172.20.20.4/24",
                { state: "exited", status: "Exited (137) 3 minutes ago" }
              ),
              container("ceos1", "dc", "arista_ceos", "ceos:4.32.0F", "172.20.21.2/24", {
                state: "created",
                status: "Created"
              }),
              container("ceos2", "dc", "arista_ceos", "ceos:4.32.0F", "172.20.21.3/24")
            ]
    };
  } else if (view === "impairments") {
    const fields = { delay: "", jitter: "", loss: "", rate: "", corruption: "" };
    win.__INITIAL_DATA__ = {
      nodeName: "clab-demo-spine1",
      interfacesData:
        state === "empty"
          ? {}
          : {
              "e1-1": { ...fields, delay: "50ms", jitter: "5ms", loss: "1" },
              "e1-2": { ...fields },
              "e1-3": { ...fields, jitter: "10ms" },
              "e1-49": { ...fields, rate: "10000" },
              mgmt0: { ...fields }
            }
    };
  } else if (view === "welcome") {
    win.__INITIAL_DATA__ = { extensionVersion: "0.24.0" };
  } else if (view === "wireshark") {
    win.__INITIAL_DATA__ = { iframeUrl: "", showVolumeTip: state !== "no-tip" };
  } else {
    win.__INITIAL_DATA__ = {
      endpointOptions: [
        { id: "local", label: "Local Docker" },
        { id: "lab-server", label: "lab-server.example" }
      ],
      selectedEndpointId: "local"
    };
  }
}

function postAfterMount(): void {
  window.setTimeout(() => {
    if (view === "welcome" && state !== "loading") {
      const repos =
        state === "empty"
          ? []
          : [
              {
                name: "srl-labs/srlinux-getting-started",
                html_url: "https://github.com/srl-labs/a",
                description: "Get started with Nokia SR Linux in a lab.",
                stargazers_count: 212
              },
              {
                name: "srl-labs/srl-telemetry-lab",
                html_url: "https://github.com/srl-labs/b",
                description: "A lab demonstrating the telemetry stack with SR Linux.",
                stargazers_count: 187
              },
              {
                name: "srl-labs/multivendor-evpn-lab",
                html_url: "https://github.com/srl-labs/c",
                description: "Multivendor EVPN lab with Nokia SR Linux, Arista cEOS and Cisco XRd.",
                stargazers_count: 96
              },
              {
                name: "hellt/clabs",
                html_url: "https://github.com/hellt/d",
                description: "",
                stargazers_count: 41
              }
            ];
      window.postMessage(
        { command: "reposLoaded", repos, usingFallback: state === "fallback" },
        "*"
      );
    }
    if (view === "wireshark") {
      window.postMessage({ type: "vnc-progress", attempt: 4, maxAttempts: 60 }, "*");
    }
  }, 200);
}

function HarnessView(): React.JSX.Element {
  switch (view) {
    case "image-dialog":
      return (
        <MuiThemeProvider>
          <Box sx={{ height: "100vh", bgcolor: "background.default" }} />
          <ContainerlabImageManagerDialog
            open
            runtime={runtime}
            onClose={() => undefined}
            endpointOptions={[{ id: "local", label: "Local Docker" }]}
          />
        </MuiThemeProvider>
      );
    case "inspect":
      return <InspectApp />;
    case "impairments":
      return <NodeImpairmentsApp />;
    case "welcome":
      return <WelcomePageApp />;
    case "wireshark":
      return <WiresharkVncApp />;
    default:
      return <ImageManagerApp runtime={runtime} initialData={window.__INITIAL_DATA__} />;
  }
}

setupInitialData();
createRoot(document.getElementById("root")!).render(
  <ClabUiRuntimeProvider runtime={runtime}>
    <HarnessView />
  </ClabUiRuntimeProvider>
);
postAfterMount();
