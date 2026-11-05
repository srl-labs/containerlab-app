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
  saveLabCopy,
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
  captureNodeInterfaces,
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
  graphTopoviewer,
  graphMermaid,
  graphDot,
  validateLab,
  generateClosTopology,
  inspectAllLabs,
  inspectOneLab,
  openBrowser,
  cloneRepo,
  deployPopularLab,
  clonePopularRepo,
  openLink,
  fclingBgpPeers,
  fclingBgpRib,
  fclingIpv4Rib,
  fclingLldp,
  fclingMac,
  fclingNi,
  fclingSubif,
  fclingSysInfo,
  fclingCustom
} from "./external";

// The Fabric view of a lab
export { openFabricView } from "./fabric";

// Lab server connections
export {
  addConnection,
  copyConnectionUrl,
  manageConnections,
  openRemoteWorkspace,
  reconnect as reconnectConnection,
  removeConnection,
  signIn as signInToLabServer,
  signOut as signOutOfLabServer
} from "./connections";
