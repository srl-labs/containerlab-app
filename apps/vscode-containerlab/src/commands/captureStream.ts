/**
 * Capture on lab hosts that capture lab links as one pcapng stream: a
 * Kubernetes cluster (c9s) on this machine, or a c9s clab-api-server.
 *
 * - Cluster on this machine: an integrated terminal runs
 *   `containerlab -r c9s capture … -w - | wireshark -k -i -` (the default
 *   when Wireshark is found here, also a Windows Wireshark under WSL), or
 *   Wireshark VNC in a webview, whose container runs on this machine's Docker
 *   and reads the capture from here (the default without a Wireshark), or the
 *   capture is saved as `.pcapng`.
 * - clab-api-server: Wireshark on this machine reads the server's capture
 *   stream (`wireshark -k -i -`, the default when Wireshark is found here), or
 *   Wireshark VNC in a webview, or the capture is saved as `.pcapng`.
 */
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

import * as vscode from "vscode";
import {
  describeCaptureGap,
  type CaptureInterface,
  type CaptureTarget,
  type LabBackend,
  type LabHostInfo
} from "@srl-labs/containerlab-lab-backend";
import {
  findWireshark,
  launchLocalWireshark,
  type LocalLabBackend
} from "@srl-labs/containerlab-lab-backend/local";

import { outputChannel } from "../globals";
import { backendFor, connectionOf } from "../backend/labBackends";
import { isClusterConnection, type LabConnection } from "../backend/connections";
import { labHostInfo } from "../backend/labHostSupport";

export type StreamCaptureDelivery = "terminal" | "wireshark" | "vnc" | "save";

/** One interface of a capture: the node as the topology names it, and the interface. */
export interface StreamCaptureTarget {
  node: string;
  interface: string;
}

/** Wireshark VNC of a cluster on this machine: the container runs here, on Docker. */
const LOCAL_VNC_DETAIL = "Wireshark in a VS Code tab, in a container on this computer's Docker";

const DELIVERY_ITEMS: Record<StreamCaptureDelivery, { label: string; detail: string }> = {
  terminal: {
    label: "$(terminal) Wireshark",
    detail: "containerlab capture … -w - | wireshark -k -i - in a terminal; Ctrl+C stops it"
  },
  wireshark: {
    label: "$(pulse) Wireshark",
    detail: "Wireshark on this computer reads the lab host's capture stream"
  },
  vnc: {
    label: "$(browser) Wireshark VNC",
    detail: "Wireshark in a VS Code tab, running on the lab host"
  },
  save: { label: "$(save) Save .pcapng…", detail: "Capture for a while and save the file" }
};

const SAVE_DURATIONS = [
  { label: "5 seconds", value: "5s" },
  { label: "30 seconds", value: "30s" },
  { label: "1 minute", value: "1m" },
  { label: "5 minutes", value: "5m" },
  { label: "Until I stop it", value: undefined }
];

/**
 * Where a capture can go, the default first. The `capture.preferredAction`
 * setting, when the user set it, picks between Wireshark on this machine and
 * VNC; else Wireshark on this machine comes first when it was found here,
 * else Wireshark VNC.
 */
export function streamCaptureDeliveries(
  onThisMachine: boolean,
  support: Pick<LabHostInfo["support"], "wiresharkVnc">,
  preferred: string | undefined,
  localWireshark = true
): StreamCaptureDelivery[] {
  // On a cluster here, a terminal pipes containerlab capture into Wireshark; else the app does.
  const wireshark: StreamCaptureDelivery = onThisMachine ? "terminal" : "wireshark";
  if (!support.wiresharkVnc) return [wireshark, "save"];
  const vncFirst = preferred === "Wireshark VNC" || (!localWireshark && preferred !== "Edgeshark");
  return vncFirst ? ["vnc", wireshark, "save"] : [wireshark, "vnc", "save"];
}

/** The capture setting only when the user set it; its default predates capture streams. */
function preferredAction(): string | undefined {
  const inspected = vscode.workspace
    .getConfiguration("containerlab")
    .inspect<string>("capture.preferredAction");
  return inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? inspected?.globalValue;
}

/** Whether the node's lab host captures lab links as one stream; undefined when it cannot be asked. */
export async function streamCaptureHost(
  node: unknown
): Promise<{ connection: LabConnection; info: LabHostInfo } | undefined> {
  const connection = connectionOf(node);
  if (connection.kind !== "api" && !isClusterConnection(connection)) return undefined;
  const info = await labHostInfo(connection);
  return info?.support.captureStream === true ? { connection, info } : undefined;
}

/** The running lab of a container name or topology node, and the node's topology name. */
async function resolveNode(
  backend: LabBackend,
  name: string,
  knownLab?: string
): Promise<{ labName: string; node: string }> {
  const labs = await backend.inspectAll();
  for (const [labName, containers] of Object.entries(labs)) {
    if (knownLab !== undefined && knownLab !== "" && labName !== knownLab) continue;
    for (const container of containers) {
      const nodeName = (container as { nodeName?: unknown }).nodeName;
      const node =
        typeof nodeName === "string" && nodeName
          ? nodeName
          : container.name.replace(`${labName}-`, "");
      if (container.name === name || node === name || container.name === `${labName}-${name}`) {
        return { labName, node };
      }
    }
  }
  throw new Error(`${name} is not a node of a running lab on this lab host.`);
}

function interfaceItem(
  entry: CaptureInterface,
  picked: boolean
): vscode.QuickPickItem & { entry: CaptureInterface } {
  const peer =
    entry.peerNode === "host"
      ? `host ${entry.peerInterface}`
      : `${entry.peerNode}:${entry.peerInterface}`;
  return {
    label: `$(plug) ${entry.interface}`,
    description: [entry.alias, `↔ ${peer}`].filter(Boolean).join(" · "),
    picked,
    entry
  };
}

/** Lab-link interfaces of the node, with their peers; the given ones ticked. */
async function pickInterfaces(
  backend: LabBackend,
  labName: string,
  node: string,
  ticked: readonly string[]
): Promise<StreamCaptureTarget[] | undefined> {
  const interfaces = (await backend.captureInterfaces(labName)).filter(
    (entry) => entry.node === node
  );
  if (interfaces.length === 0) {
    void vscode.window.showWarningMessage(
      `${node} has no lab links to capture. On Kubernetes only interfaces of links between nodes can be captured.`
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    interfaces.map((entry) =>
      interfaceItem(
        entry,
        ticked.length === 0 ||
          ticked.includes(entry.interface) ||
          ticked.includes(entry.alias ?? "")
      )
    ),
    {
      canPickMany: true,
      matchOnDescription: true,
      title: `Capture packets on ${node}`,
      placeHolder: "Lab-link interfaces"
    }
  );
  if (!picked || picked.length === 0) return undefined;
  return picked.map((item) => ({ node, interface: item.entry.interface }));
}

/** How the host's ways to capture read in the picker. */
interface DeliveryChoices {
  deliveries: StreamCaptureDelivery[];
  /** The lab host is a cluster on this machine. */
  local: boolean;
  /** Why Wireshark VNC is not offered, when the host could offer it. */
  vncUnavailable?: string;
}

function deliveryItem(delivery: StreamCaptureDelivery, local: boolean) {
  const item = DELIVERY_ITEMS[delivery];
  return {
    ...item,
    ...(delivery === "vnc" && local ? { detail: LOCAL_VNC_DETAIL } : {}),
    delivery
  };
}

async function pickDelivery(
  choices: DeliveryChoices,
  title: string
): Promise<StreamCaptureDelivery | undefined> {
  const { deliveries, local, vncUnavailable } = choices;
  if (deliveries.length === 1 && !vncUnavailable) return deliveries[0];
  type Item = vscode.QuickPickItem & { delivery?: StreamCaptureDelivery };
  const items: Item[] = deliveries.map((delivery) => deliveryItem(delivery, local));
  // A quick pick has no disabled items: Wireshark VNC stays listed, with why it cannot open.
  if (vncUnavailable) {
    items.push({
      label: DELIVERY_ITEMS.vnc.label,
      description: "unavailable",
      detail: vncUnavailable
    });
  }
  const picked = await vscode.window.showQuickPick(items, {
    title,
    placeHolder: "Open the capture in"
  });
  if (picked && !picked.delivery && vncUnavailable) {
    void vscode.window.showWarningMessage(vncUnavailable);
  }
  return picked?.delivery;
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** `containerlab -r c9s capture … -w - | wireshark -k -i -`, for a terminal. */
export function captureTerminalCommand(captureCommand: string, wireshark: string): string {
  return `${captureCommand} | ${shellQuote(wireshark)} -k -i -`;
}

/** Wireshark on this machine: the configured path, the usual install locations, PATH, or Windows under WSL. */
function findLocalWireshark(): Promise<string | undefined> {
  return findWireshark(
    vscode.workspace.getConfiguration("containerlab").get<string>("capture.wireshark.path", "") ||
      undefined
  );
}

/**
 * No Wireshark here: the capture can still open in Wireshark VNC or be
 * saved, or the user points the setting at Wireshark.
 */
async function wiresharkNotFound(
  choices: DeliveryChoices,
  open: (delivery: StreamCaptureDelivery) => Promise<void>
): Promise<void> {
  const vnc = "Open in Wireshark VNC";
  const save = "Save .pcapng…";
  const setPath = "Set Wireshark path";
  const actions = [...(choices.deliveries.includes("vnc") ? [vnc] : []), save, setPath];
  const reason = choices.vncUnavailable ? ` ${choices.vncUnavailable}.` : "";
  const choice = await vscode.window.showWarningMessage(
    `Wireshark was not found on this machine.${reason}`,
    ...actions
  );
  if (choice === vnc) await open("vnc");
  else if (choice === save) await open("save");
  else if (choice === setPath)
    await vscode.commands.executeCommand(
      "workbench.action.openSettings",
      "containerlab.capture.wireshark.path"
    );
}

async function captureInTerminal(
  backend: LocalLabBackend,
  labName: string,
  targets: StreamCaptureTarget[],
  label: string,
  wireshark: string
): Promise<void> {
  const { command, env } = await backend.captureCommandLine(labName, toCaptureTargets(targets));
  const terminal = vscode.window.createTerminal({
    name: `Capture ${label}`,
    env,
    iconPath: new vscode.ThemeIcon("pulse")
  });
  terminal.sendText(captureTerminalCommand(command, wireshark));
  terminal.show();
}

function toCaptureTargets(targets: readonly StreamCaptureTarget[]): CaptureTarget[] {
  return targets.map((target) => ({ containerName: target.node, interfaceName: target.interface }));
}

function fileStamp(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
}

/** Captures for a chosen time, or until cancelled, into a `.pcapng` the user picks. */
async function saveCapture(
  backend: LabBackend,
  labName: string,
  targets: StreamCaptureTarget[],
  label: string
): Promise<void> {
  const duration = await vscode.window.showQuickPick(SAVE_DURATIONS, {
    title: `Capture ${label}`,
    placeHolder: "Capture for"
  });
  if (!duration) return;
  const defaultFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const file = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(defaultFolder, `${labName}-${fileStamp()}.pcapng`)),
    filters: { "Packet capture": ["pcapng"] }
  });
  if (!file) return;
  let bytes = 0;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Capturing ${label}`,
      cancellable: true
    },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      progress.report({ message: duration.value ? `for ${duration.label}` : "until you cancel" });
      try {
        const stream = await backend.openCaptureStream(labName, {
          targets: toCaptureTargets(targets),
          ...(duration.value ? { duration: duration.value } : {}),
          signal: controller.signal,
          // A segment switch that missed packets: a status line, the capture goes on.
          onGap: (gap) =>
            vscode.window.setStatusBarMessage(`$(warning) ${describeCaptureGap(gap)}`, 15_000)
        });
        async function* counted(): AsyncGenerator<Uint8Array> {
          for await (const chunk of stream) {
            bytes += chunk.byteLength;
            progress.report({ message: `${Math.round(bytes / 1024)} KiB` });
            yield chunk;
          }
        }
        await pipeline(Readable.from(counted()), fs.createWriteStream(file.fsPath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Capture failed: ${message}`);
        return;
      }
      const reveal = "Reveal";
      void vscode.window
        .showInformationMessage(
          `Saved ${Math.round(bytes / 1024)} KiB to ${path.basename(file.fsPath)}.`,
          reveal
        )
        .then((choice) => {
          if (choice === reveal) void vscode.commands.executeCommand("revealFileInOS", file);
        });
    }
  );
}

/** Wireshark on this machine reading the lab host's capture stream; closing Wireshark ends the capture. */
async function captureInLocalWireshark(
  backend: LabBackend,
  labName: string,
  targets: StreamCaptureTarget[],
  label: string,
  wireshark: string
): Promise<void> {
  const controller = new AbortController();
  const stream = await backend.openCaptureStream(labName, {
    targets: toCaptureTargets(targets),
    signal: controller.signal,
    onGap: (gap) =>
      vscode.window.setStatusBarMessage(`$(warning) ${describeCaptureGap(gap)}`, 15_000)
  });
  try {
    const session = await launchLocalWireshark(stream, {
      title: `${labName}: ${label}`,
      binaryPath: wireshark,
      stopCapture: () => controller.abort()
    });
    outputChannel.info(`Wireshark (pid ${session.pid ?? "?"}) captures ${label} of ${labName}`);
  } catch (error) {
    // Nobody reads the capture: end it on the lab host.
    controller.abort();
    await stream[Symbol.asyncIterator]().return?.();
    throw error;
  }
}

export interface StreamCaptureRequest {
  /** Interfaces by container or node name; with `pick`, the node's ticked interfaces. */
  targets: Array<{ name: string; interface?: string; labName?: string }>;
  /** Ask which lab-link interfaces of the (first) node to capture. */
  pick?: boolean;
  /** The way the user asked for, e.g. the Wireshark VNC command; else the host's default. */
  delivery?: StreamCaptureDelivery;
  /** Ask where the capture goes. */
  askDelivery?: boolean;
  /** Opens Wireshark VNC for the targets, through the existing session code. */
  openVnc?: (labName: string, targets: StreamCaptureTarget[]) => Promise<void>;
}

async function resolveTargets(
  backend: LabBackend,
  request: StreamCaptureRequest
): Promise<{ labName: string; targets: StreamCaptureTarget[] } | undefined> {
  const first = request.targets.at(0);
  if (!first) return undefined;
  const { labName, node } = await resolveNode(backend, first.name, first.labName);
  if (request.pick) {
    const ticked = request.targets.flatMap((target) =>
      target.interface ? [target.interface] : []
    );
    const targets = await pickInterfaces(backend, labName, node, ticked);
    return targets ? { labName, targets } : undefined;
  }
  const targets: StreamCaptureTarget[] = [];
  for (const target of request.targets) {
    if (!target.interface) continue;
    const resolved =
      target.name === first.name ? { node } : await resolveNode(backend, target.name, labName);
    targets.push({ node: resolved.node, interface: target.interface });
  }
  return { labName, targets };
}

/** The way the request names, if the host has it; else asked, or the host's default. */
async function chooseDelivery(
  request: StreamCaptureRequest,
  choices: DeliveryChoices,
  label: string
): Promise<StreamCaptureDelivery | undefined> {
  if (request.delivery && choices.deliveries.includes(request.delivery)) return request.delivery;
  if (request.delivery === "vnc" && choices.vncUnavailable) {
    void vscode.window.showWarningMessage(choices.vncUnavailable);
    return undefined;
  }
  if (request.askDelivery) return pickDelivery(choices, `Capture ${label}`);
  return choices.deliveries[0];
}

/** Captures on a lab host with capture streams; the host must be one (`streamCaptureHost`). */
export async function captureOnStreamHost(
  host: { connection: LabConnection; info: LabHostInfo },
  request: StreamCaptureRequest
): Promise<void> {
  try {
    const backend = backendFor(host.connection);
    const resolved = await resolveTargets(backend, request);
    if (!resolved || resolved.targets.length === 0) return;
    const { labName, targets } = resolved;
    const label = targets.map((target) => `${target.node}:${target.interface}`).join(", ");
    const local = host.connection.kind === "local";
    const wireshark = await findLocalWireshark();
    const vncUnavailable = host.info.support.wiresharkVnc
      ? undefined
      : host.info.profile.wiresharkVncUnavailable;
    const choices: DeliveryChoices = {
      deliveries: streamCaptureDeliveries(
        local,
        host.info.support,
        preferredAction(),
        wireshark !== undefined
      ),
      local,
      ...(vncUnavailable ? { vncUnavailable } : {})
    };
    const open = async (delivery: StreamCaptureDelivery | undefined): Promise<void> => {
      if (delivery === "terminal" || delivery === "wireshark") {
        if (!wireshark) await wiresharkNotFound(choices, open);
        else if (delivery === "terminal")
          await captureInTerminal(backend as LocalLabBackend, labName, targets, label, wireshark);
        else await captureInLocalWireshark(backend, labName, targets, label, wireshark);
      } else if (delivery === "vnc") await request.openVnc?.(labName, targets);
      else if (delivery === "save") await saveCapture(backend, labName, targets, label);
    };
    await open(await chooseDelivery(request, choices, label));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Capture failed: ${message}`);
  }
}
