/**
 * Network and interface commands - capture, impairments, edgeshark
 */

export {
  captureInterface,
  captureInterfaceWithPacketflix,
  captureInterfaceWithWireshark,
  captureEdgesharkVNC,
  captureNodeInterfaces,
  killAllWiresharkVNCCtrs,
  setSessionHostname
} from "../capture";
export {
  setLinkDelay,
  setLinkJitter,
  setLinkLoss,
  setLinkRate,
  setLinkCorruption,
  setImpairment
} from "../impairments";
export { installEdgeshark, uninstallEdgeshark } from "../edgeshark";
