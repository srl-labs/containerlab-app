/**
 * Shared Lab Settings types.
 *
 * These reflect Containerlab's top-level "name", "prefix", and "mgmt" fields.
 * Kept in shared/types so both extension host and webview can use the same shape.
 */

export interface LabSettings {
  name?: string;
  prefix?: string | null;
  mgmt?: MgmtSettings | null;
  /** Set instead of `mgmt` when the topology defines a list of management networks. */
  mgmtNetworks?: MgmtSettings[];
  /** `topology.defaults.mgmt-net`: the management network nodes use unless they pick one. */
  defaultMgmtNet?: string;
}

export interface MgmtSettings {
  network?: string;
  "ipv4-subnet"?: string;
  "ipv4-gw"?: string;
  "ipv4-range"?: string;
  "ipv6-subnet"?: string;
  "ipv6-gw"?: string;
  "ipv6-range"?: string;
  mtu?: number;
  bridge?: string;
  "external-access"?: boolean;
  "skip-when-unused"?: boolean;
  "driver-opts"?: Record<string, string>;
  /** `bridge` (default) or `macvlan` */
  driver?: string;
  ipam?: MgmtIpamSettings;
  "macvlan-parent"?: string;
  "macvlan-mode"?: string;
  "macvlan-aux"?: boolean;
}

export interface MgmtIpamSettings {
  /** `containerlab` (default) or `runtime` */
  provider?: string;
  /** Duplicate address detection; on unless false */
  dad?: boolean;
}

/** Docker network containerlab uses when a management network has no name. */
export const DEFAULT_MGMT_NETWORK_NAME = "clab";

/**
 * The management networks of a lab, in order. The first one is the default.
 * A single `mgmt` map is a list of one; a lab without `mgmt` has none.
 */
export function getMgmtNetworks(settings: LabSettings | undefined): MgmtSettings[] {
  if (settings?.mgmtNetworks) return settings.mgmtNetworks;
  return settings?.mgmt ? [settings.mgmt] : [];
}

/** Docker network name of a management network; an unnamed one is `clab`. */
export function getMgmtNetworkName(network: MgmtSettings | undefined): string {
  const name = network?.network;
  return typeof name === "string" && name !== "" ? name : DEFAULT_MGMT_NETWORK_NAME;
}

/**
 * Changes applied by the Lab Settings form. Absent keys stay untouched and `null`
 * removes a key.
 */
export interface LabSettingsUpdate {
  name?: string;
  prefix?: string | null;
  /**
   * The full list of management networks, in order. Each entry is merged key by
   * key into the network it was loaded from. One network is written as a map
   * (unless the file already used a list), several as a list.
   */
  mgmt?: MgmtNetworkUpdate[];
  /** `mgmt-net` references in nodes, groups, kinds and defaults to rename (old -> new). */
  mgmtNetRenames?: Record<string, string>;
  /** New `topology.defaults.mgmt-net`; null removes it. */
  defaultMgmtNet?: string | null;
}

export interface MgmtNetworkUpdate {
  /** Index of the existing network this entry was loaded from; absent for a new network. */
  source?: number;
  changes: MgmtSettingsUpdate;
}

/** Nested maps are merged key by key; `null` removes a key. */
export type MgmtSettingsUpdate = {
  [K in Exclude<keyof MgmtSettings, "driver-opts" | "ipam">]?: MgmtSettings[K] | null;
} & {
  "driver-opts"?: Record<string, string | null> | null;
  ipam?: { [K in keyof MgmtIpamSettings]?: MgmtIpamSettings[K] | null } | null;
};
