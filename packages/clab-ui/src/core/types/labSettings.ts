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
}

export interface MgmtSettings {
  network?: string;
  "ipv4-subnet"?: string;
  "ipv4-gw"?: string;
  "ipv4-range"?: string;
  "ipv6-subnet"?: string;
  "ipv6-gw"?: string;
  mtu?: number;
  bridge?: string;
  "external-access"?: boolean;
  "driver-opts"?: Record<string, string>;
  driver?: string;
}

/**
 * Changes applied by the Lab Settings form. Absent keys stay untouched and `null`
 * removes a key. `mgmt` is merged key by key into the existing map.
 */
export interface LabSettingsUpdate {
  name?: string;
  prefix?: string | null;
  mgmt?: MgmtSettingsUpdate;
}

export type MgmtSettingsUpdate = {
  [K in Exclude<keyof MgmtSettings, "driver-opts">]?: MgmtSettings[K] | null;
} & {
  "driver-opts"?: Record<string, string | null> | null;
};
