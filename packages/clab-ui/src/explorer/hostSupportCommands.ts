import { KUBERNETES_LIMITS, type KubernetesLimitKey } from "../host/kubernetesLimits";
import type { LabHostInfo, LabHostSupport } from "../host/labHostSupport";

const FCLI_COMMANDS = [
  "containerlab.lab.fcli.bgpPeers",
  "containerlab.lab.fcli.bgpRib",
  "containerlab.lab.fcli.custom",
  "containerlab.lab.fcli.lldp",
  "containerlab.lab.fcli.mac",
  "containerlab.lab.fcli.ni",
  "containerlab.lab.fcli.subif",
  "containerlab.lab.fcli.sysInfo"
];

const SHARE_COMMANDS = [
  "containerlab.lab.sshx.attach",
  "containerlab.lab.sshx.detach",
  "containerlab.lab.sshx.reattach",
  "containerlab.lab.sshx.copyLink",
  "containerlab.lab.gotty.attach",
  "containerlab.lab.gotty.detach",
  "containerlab.lab.gotty.reattach",
  "containerlab.lab.gotty.copyLink"
];

const NETEM_COMMANDS = [
  "containerlab.interface.setDelay",
  "containerlab.interface.setJitter",
  "containerlab.interface.setLoss",
  "containerlab.interface.setRate",
  "containerlab.interface.setCorruption",
  "containerlab.node.manageImpairments"
];

/** Explorer commands and the lab host support each needs. */
const COMMANDS_BY_SUPPORT: ReadonlyArray<readonly [keyof LabHostSupport, readonly string[]]> = [
  ["imageManagement", ["containerlab.images.manage"]],
  ["netem", NETEM_COMMANDS],
  ["nodePause", ["containerlab.node.pause", "containerlab.node.unpause"]],
  ["fcli", FCLI_COMMANDS],
  ["shareTools", SHARE_COMMANDS],
  ["edgesharkManagement", ["containerlab.install.edgeshark", "containerlab.uninstall.edgeshark"]],
  ["edgeshark", ["containerlab.interface.captureWithEdgeshark"]],
  ["wiresharkVnc", ["containerlab.interface.captureWithEdgesharkVNC", "containerlab.capture.killAllWiresharkVNC"]]
];

/**
 * The explorer commands a lab host cannot run, so hosts hide them on its
 * items instead of letting them fail.
 */
export function hiddenExplorerCommandsForSupport(support: LabHostSupport): string[] {
  const hidden = COMMANDS_BY_SUPPORT.flatMap(([flag, commands]) => (support[flag] ? [] : commands));
  // A c9s lab host captures through its own capture stream instead.
  if (!support.hostCapture && !support.captureStream) {
    hidden.push("containerlab.interface.capture");
  }
  if (!support.edgeshark && !support.wiresharkVnc && !support.hostCapture && !support.captureStream) {
    hidden.push("containerlab.node.captureInterfaces");
  }
  return hidden;
}

/** Explorer commands a Kubernetes (c9s) lab host lacks, and the limit that says why. */
const KUBERNETES_GREYED_COMMANDS: ReadonlyArray<readonly [KubernetesLimitKey, readonly string[]]> = [
  ["linkImpairments", NETEM_COMMANDS],
  ["nodePause", ["containerlab.node.pause", "containerlab.node.unpause"]],
  ["fcli", FCLI_COMMANDS],
  ["shareTools", SHARE_COMMANDS],
  [
    "edgeshark",
    [
      "containerlab.interface.captureWithEdgeshark",
      "containerlab.install.edgeshark",
      "containerlab.uninstall.edgeshark"
    ]
  ]
];

/**
 * Explorer commands to show greyed out on a lab host's items, with why,
 * instead of hiding them: what a Kubernetes (c9s) lab host lacks. Other
 * lab hosts grey nothing out.
 */
export function greyedExplorerCommandsForHost(info: Pick<LabHostInfo, "profile">): Map<string, string> {
  const greyed = new Map<string, string>();
  if (info.profile.runtime !== "c9s") return greyed;
  for (const [key, commands] of KUBERNETES_GREYED_COMMANDS) {
    for (const command of commands) greyed.set(command, KUBERNETES_LIMITS[key].reason);
  }
  return greyed;
}
