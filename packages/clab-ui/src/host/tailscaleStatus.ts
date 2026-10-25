/**
 * Tailscale devices of a running lab, as clab-api-server reports them
 * (`GET /api/v1/labs/{lab}/tailscale`).
 */
import { isRecord } from "../core/utilities/typeHelpers";

export interface TailscaleForward {
  listenPort: number;
  /** `address:port` the proxy forwards to */
  target: string;
  nodeName?: string;
}

export interface TailscaleDevice {
  /**
   * `proxy` for the SSO proxy of the lab, `sidecar` for the auth-key sidecar of
   * `nodeName`, or `node` for a node of the tailscale kind.
   */
  role: string;
  nodeName?: string;
  containerName: string;
  /** Container state, e.g. `running` */
  state: string;
  /** tailscaled state, e.g. `NeedsLogin` or `Running` */
  backendState?: string;
  /** Login URL while the device waits for authentication */
  authUrl?: string;
  hostName?: string;
  dnsName?: string;
  tailscaleIps?: string[];
  online: boolean;
  /** Tailnet ports the proxy forwards to nodes (`/ts` ports) */
  forwards?: TailscaleForward[];
  /** Why the tailnet state could not be read */
  error?: string;
}

export interface TailscaleStatus {
  labName: string;
  devices: TailscaleDevice[];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function parseForward(value: unknown): TailscaleForward | undefined {
  if (!isRecord(value) || typeof value.listenPort !== "number") return undefined;
  return {
    listenPort: value.listenPort,
    target: typeof value.target === "string" ? value.target : "",
    nodeName: optionalString(value.nodeName)
  };
}

function parseDevice(value: unknown): TailscaleDevice | undefined {
  if (!isRecord(value) || typeof value.role !== "string") return undefined;
  const ips = Array.isArray(value.tailscaleIps)
    ? value.tailscaleIps.filter((ip): ip is string => typeof ip === "string")
    : undefined;
  const forwards = Array.isArray(value.forwards)
    ? value.forwards.map(parseForward).filter((forward) => forward !== undefined)
    : undefined;
  return {
    role: value.role,
    nodeName: optionalString(value.nodeName),
    containerName: typeof value.containerName === "string" ? value.containerName : "",
    state: typeof value.state === "string" ? value.state : "",
    backendState: optionalString(value.backendState),
    authUrl: optionalString(value.authUrl),
    hostName: optionalString(value.hostName),
    dnsName: optionalString(value.dnsName),
    tailscaleIps: ips,
    online: value.online === true,
    forwards,
    error: optionalString(value.error)
  };
}

/** Reads a status answer; undefined when it is not one. */
export function parseTailscaleStatus(value: unknown): TailscaleStatus | undefined {
  if (!isRecord(value) || !Array.isArray(value.devices)) return undefined;
  return {
    labName: typeof value.labName === "string" ? value.labName : "",
    devices: value.devices.map(parseDevice).filter((device) => device !== undefined)
  };
}
