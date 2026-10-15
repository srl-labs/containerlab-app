/**
 * Lab Settings form state: parsing from the topology and turning edits into a
 * minimal update, so Apply only touches the keys the user actually changed.
 */
import type {
  LabSettings,
  LabSettingsUpdate,
  MgmtSettingsUpdate
} from "../../core/types/labSettings";
import type {
  PrefixType,
  IpType,
  DriverOption,
  BasicSettingsState,
  MgmtSettingsState
} from "../../components/panels/lab-settings/types";

/** Parses prefix settings from lab settings */
function parsePrefixSettings(
  settings?: LabSettings
): Pick<BasicSettingsState, "prefixType" | "customPrefix"> {
  if (!settings || settings.prefix === undefined) {
    return { prefixType: "default", customPrefix: "" };
  }
  if (settings.prefix === "") {
    return { prefixType: "no-prefix", customPrefix: "" };
  }
  if (settings.prefix !== null && settings.prefix !== "clab") {
    return { prefixType: "custom", customPrefix: settings.prefix };
  }
  return { prefixType: "default", customPrefix: "" };
}

function parseIpv4Settings(
  mgmt?: LabSettings["mgmt"]
): Pick<MgmtSettingsState, "ipv4Type" | "ipv4Subnet" | "ipv4Gateway" | "ipv4Range"> {
  const result = { ipv4Type: "default" as IpType, ipv4Subnet: "", ipv4Gateway: "", ipv4Range: "" };
  const ipv4Subnet = mgmt?.["ipv4-subnet"];
  if (ipv4Subnet === undefined || ipv4Subnet === "") return result;

  if (ipv4Subnet === "auto") {
    return { ...result, ipv4Type: "auto" };
  }
  return {
    ipv4Type: "custom",
    ipv4Subnet,
    ipv4Gateway: mgmt?.["ipv4-gw"] ?? "",
    ipv4Range: mgmt?.["ipv4-range"] ?? ""
  };
}

function parseIpv6Settings(
  mgmt?: LabSettings["mgmt"]
): Pick<MgmtSettingsState, "ipv6Type" | "ipv6Subnet" | "ipv6Gateway"> {
  const result = { ipv6Type: "default" as IpType, ipv6Subnet: "", ipv6Gateway: "" };
  const ipv6Subnet = mgmt?.["ipv6-subnet"];
  if (ipv6Subnet === undefined || ipv6Subnet === "") return result;

  if (ipv6Subnet === "auto") {
    return { ...result, ipv6Type: "auto" };
  }
  return {
    ipv6Type: "custom",
    ipv6Subnet,
    ipv6Gateway: mgmt?.["ipv6-gw"] ?? ""
  };
}

function parseDriverOptions(mgmt?: LabSettings["mgmt"]): DriverOption[] {
  const opts = mgmt?.["driver-opts"];
  if (!opts) return [];
  return Object.entries(opts).map(([key, value]) => ({ key, value }));
}

export function buildInitialBasic(settings?: LabSettings): BasicSettingsState {
  const prefix = parsePrefixSettings(settings);
  return {
    labName: settings?.name ?? "",
    prefixType: prefix.prefixType,
    customPrefix: prefix.customPrefix
  };
}

export function buildInitialMgmt(settings?: LabSettings): MgmtSettingsState {
  const mgmt = settings?.mgmt ?? undefined;
  const ipv4 = parseIpv4Settings(mgmt);
  const ipv6 = parseIpv6Settings(mgmt);

  return {
    networkName: mgmt?.network ?? "",
    ipv4Type: ipv4.ipv4Type,
    ipv4Subnet: ipv4.ipv4Subnet,
    ipv4Gateway: ipv4.ipv4Gateway,
    ipv4Range: ipv4.ipv4Range,
    ipv6Type: ipv6.ipv6Type,
    ipv6Subnet: ipv6.ipv6Subnet,
    ipv6Gateway: ipv6.ipv6Gateway,
    mtu: mgmt?.mtu !== undefined ? String(mgmt.mtu) : "",
    bridge: mgmt?.bridge ?? "",
    externalAccess: mgmt?.["external-access"] !== false,
    driverOptions: parseDriverOptions(mgmt)
  };
}

function gatherPrefix(prefixType: PrefixType, customPrefix: string): string | null {
  if (prefixType === "custom") return customPrefix;
  if (prefixType === "no-prefix") return "";
  return null;
}

type GatheredMgmt = Record<string, string | number | boolean | Record<string, string>>;

function gatherIpv4Settings(mgmtState: MgmtSettingsState): Record<string, string> {
  const ipv4: Record<string, string> = {};
  if (mgmtState.ipv4Type === "auto") {
    ipv4["ipv4-subnet"] = "auto";
    return ipv4;
  }
  if (mgmtState.ipv4Type === "custom") {
    if (mgmtState.ipv4Subnet) ipv4["ipv4-subnet"] = mgmtState.ipv4Subnet;
    if (mgmtState.ipv4Gateway) ipv4["ipv4-gw"] = mgmtState.ipv4Gateway;
    if (mgmtState.ipv4Range) ipv4["ipv4-range"] = mgmtState.ipv4Range;
  }
  return ipv4;
}

function gatherIpv6Settings(mgmtState: MgmtSettingsState): Record<string, string> {
  const ipv6: Record<string, string> = {};
  if (mgmtState.ipv6Type === "auto") {
    ipv6["ipv6-subnet"] = "auto";
    return ipv6;
  }
  if (mgmtState.ipv6Type === "custom") {
    if (mgmtState.ipv6Subnet) ipv6["ipv6-subnet"] = mgmtState.ipv6Subnet;
    if (mgmtState.ipv6Gateway) ipv6["ipv6-gw"] = mgmtState.ipv6Gateway;
  }
  return ipv6;
}

/** mgmt keys the form owns, in the order new keys are written. */
const MGMT_FORM_KEYS = [
  "network",
  "ipv4-subnet",
  "ipv4-gw",
  "ipv4-range",
  "ipv6-subnet",
  "ipv6-gw",
  "mtu",
  "bridge",
  "external-access",
  "driver-opts"
] as const;

/** The mgmt values the form currently represents, without defaults. */
function gatherMgmtSettings(mgmtState: MgmtSettingsState): GatheredMgmt {
  const mgmt: GatheredMgmt = {};

  if (mgmtState.networkName) mgmt.network = mgmtState.networkName;
  Object.assign(mgmt, gatherIpv4Settings(mgmtState), gatherIpv6Settings(mgmtState));

  const mtu = mgmtState.mtu ? parseInt(mgmtState.mtu, 10) : NaN;
  if (Number.isFinite(mtu)) mgmt.mtu = mtu;
  if (mgmtState.bridge) mgmt.bridge = mgmtState.bridge;
  if (!mgmtState.externalAccess) mgmt["external-access"] = false;

  const driverOpts: Record<string, string> = {};
  mgmtState.driverOptions.forEach((opt) => {
    if (opt.key && opt.value) driverOpts[opt.key] = opt.value;
  });
  if (Object.keys(driverOpts).length > 0) mgmt["driver-opts"] = driverOpts;

  return mgmt;
}

function diffStringMap(
  before: Record<string, string>,
  after: Record<string, string>
): Record<string, string | null> {
  const changes: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(after)) {
    if (before[key] !== value) changes[key] = value;
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) changes[key] = null;
  }
  return changes;
}

function diffMgmtSettings(before: GatheredMgmt, after: GatheredMgmt): MgmtSettingsUpdate {
  const changes: Record<string, unknown> = {};
  for (const key of MGMT_FORM_KEYS) {
    const prev = before[key] as GatheredMgmt[string] | undefined;
    const next = after[key] as GatheredMgmt[string] | undefined;
    if (next === undefined) {
      if (prev !== undefined) changes[key] = null;
    } else if (typeof next === "object") {
      const optChanges = diffStringMap(typeof prev === "object" ? prev : {}, next);
      if (Object.keys(optChanges).length > 0) {
        changes[key] = prev === undefined ? next : optChanges;
      }
    } else if (prev !== next) {
      changes[key] = next;
    }
  }
  return changes;
}

/**
 * Compares the form against the settings it was loaded from and returns only the
 * changes, or null when nothing changed. A list of management networks is never
 * touched by the single-network form.
 */
export function buildLabSettingsUpdate(
  settings: LabSettings | undefined,
  basic: BasicSettingsState,
  mgmt: MgmtSettingsState
): LabSettingsUpdate | null {
  const initialBasic = buildInitialBasic(settings);
  const update: LabSettingsUpdate = {};

  if (basic.labName && basic.labName !== initialBasic.labName) {
    update.name = basic.labName;
  }

  const prefix = gatherPrefix(basic.prefixType, basic.customPrefix);
  if (prefix !== gatherPrefix(initialBasic.prefixType, initialBasic.customPrefix)) {
    update.prefix = prefix;
  }

  if (!settings?.mgmtNetworks) {
    const mgmtChanges = diffMgmtSettings(
      gatherMgmtSettings(buildInitialMgmt(settings)),
      gatherMgmtSettings(mgmt)
    );
    if (Object.keys(mgmtChanges).length > 0) update.mgmt = mgmtChanges;
  }

  return Object.keys(update).length > 0 ? update : null;
}
