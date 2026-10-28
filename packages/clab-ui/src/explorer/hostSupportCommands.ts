import type { LabHostSupport } from "../host/labHostSupport";

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
  ["wiresharkVnc", ["containerlab.interface.captureWithEdgesharkVNC", "containerlab.capture.killAllWiresharkVNC"]],
  ["hostCapture", ["containerlab.interface.capture"]]
];

/**
 * The explorer commands a lab host cannot run, so hosts hide them on its
 * items instead of letting them fail.
 */
export function hiddenExplorerCommandsForSupport(support: LabHostSupport): string[] {
  const hidden = COMMANDS_BY_SUPPORT.flatMap(([flag, commands]) => (support[flag] ? [] : commands));
  if (!support.edgeshark && !support.wiresharkVnc && !support.hostCapture) {
    hidden.push("containerlab.node.captureInterfaces");
  }
  return hidden;
}
