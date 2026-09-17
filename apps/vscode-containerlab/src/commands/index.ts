/**
 * Commands barrel file - re-exports from sub-barrels
 */

// Lifecycle commands (deploy, destroy, redeploy, apply, save)
export {
  apply,
  deploy,
  deployCleanup,
  deploySpecificFile,
  destroy,
  destroyCleanup,
  startLab,
  stopLab,
  restartLab,
  redeploy,
  redeployCleanup,
  saveLab,
  saveNode
} from "./lifecycle";

// Node-related commands
export {
  startNode,
  stopNode,
  restartNode,
  pauseNode,
  unpauseNode,
  attachShell,
  telnetToNode,
  sshToNode,
  sshToLab,
  manageNodeImpairments,
  showLogs,
  sshxAttach,
  sshxDetach,
  sshxReattach,
  sshxCopyLink,
  gottyAttach,
  gottyDetach,
  gottyReattach,
  gottyCopyLink
} from "./node";

// Network and interface commands
export {
  captureInterface,
  captureInterfaceWithPacketflix,
  captureEdgesharkVNC,
  killAllWiresharkVNCCtrs,
  setSessionHostname,
  setLinkDelay,
  setLinkJitter,
  setLinkLoss,
  setLinkRate,
  setLinkCorruption,
  setImpairment,
  installEdgeshark,
  uninstallEdgeshark
} from "./network";

// Workspace and file management commands
export {
  openLabFile,
  addLabFolderToWorkspace,
  openFolderInNewWindow,
  copyLabPath,
  copyContainerIPv4Address,
  copyContainerIPv6Address,
  copyContainerName,
  copyContainerID,
  copyContainerKind,
  copyContainerImage,
  copyMACAddress,
  deleteLab,
  toggleFavorite
} from "./workspace";

// External tool and repo commands
export { manageImages } from "./images";

export {
  graphDrawIOHorizontal,
  graphDrawIOVertical,
  graphDrawIOInteractive,
  graphTopoviewer,
  inspectAllLabs,
  inspectOneLab,
  openBrowser,
  cloneRepo,
  deployPopularLab,
  clonePopularRepo,
  openLink,
  fcliBgpPeers,
  fcliBgpRib,
  fcliIpv4Rib,
  fcliLldp,
  fcliMac,
  fcliNi,
  fcliSubif,
  fcliSysInfo,
  fcliCustom
} from "./external";
