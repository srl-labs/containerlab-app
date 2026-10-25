/**
 * SSH login users by node kind, from containerlab's default node credentials.
 * Kinds not listed log in as `admin`.
 */
export const DEFAULT_SSH_USERS_BY_KIND: Readonly<Record<string, string>> = {
  nokia_srlinux: "admin",
  nokia_sros: "admin",
  arista_ceos: "admin",
  cisco_xrd: "clab",
  cisco_xrd_vrouter: "clab",
  cisco_xrv: "clab",
  cisco_xrv9k: "clab",
  cisco_c8000: "cisco",
  arrcus_arcos: "clab",
  generic_vm: "clab",
  ciena_saos: "diag",
  nvidia_cumulusvx: "cumulus",
  juniper_crpd: "root",
  juniper_csrx: "root",
  fdio_vpp: "root"
};

/** Commands that open a node's CLI through the container runtime's exec, by node kind. */
export const DEFAULT_EXEC_COMMANDS_BY_KIND: Readonly<Record<string, string>> = {
  nokia_srlinux: "sr_cli",
  cisco_xrd: "/pkg/bin/xr_cli.sh",
  frr: "vtysh",
  frrouting: "vtysh"
};
