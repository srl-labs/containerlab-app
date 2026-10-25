// IOL groups interfaces in slots of four ports (e0/0 is management), up to slot 9.
const CISCO_IOL_INTERFACE_PATTERN = [
  "e0/{n:1-3}",
  ...Array.from({ length: 9 }, (_, index) => `e${index + 1}/{n:0-3}`)
].join(",");

// Patterns follow each kind's interface naming in containerlab; kinds not listed use ethN.
export const DEFAULT_INTERFACE_PATTERNS: Record<string, string> = {
  nokia_srlinux: "e1-{n}",
  nokia_srsim: "1/1/c{n}/1",
  nokia_sros: "1/1/{n}",
  // XR data ports start at 0.
  cisco_xrd: "Gi0-0-0-{n:0}",
  // vmxnet3 NICs (the default) appear as TenGigE0/0/0/X.
  cisco_xrd_vrouter: "Te0/0/0/{n:0}",
  cisco_xrv: "Gi0/0/0/{n:0}",
  cisco_xrv9k: "Gi0/0/0/{n:0}",
  // Gi1 is the management interface; data interfaces start at Gi2.
  cisco_csr1000v: "Gi{n:2}",
  cisco_c8000v: "Gi{n:2}",
  cisco_cat9kv: "Gi1/0/{n}",
  cisco_n9kv: "Ethernet1/{n}",
  cisco_asav: "Gi0/{n:0}",
  cisco_ftdv: "Gi0/{n:0}",
  cisco_vios: "Gi{n:0}",
  cisco_iol: CISCO_IOL_INTERFACE_PATTERN,
  // Cisco 8000 only accepts Fi0_0_0_X, Hu0_0_0_X or FH0_0_0_X; the 8201-32FH image has 400G ports.
  cisco_c8000: "FH0_0_0_{n:0}",
  arista_veos: "Et1/{n}",
  juniper_vmx: "et-0/0/{n:0}",
  juniper_vqfx: "et-0/0/{n:0}",
  juniper_vjunosevolved: "et-0/0/{n:0}",
  juniper_vsrx: "ge-0/0/{n:0}",
  juniper_vjunosrouter: "ge-0/0/{n:0}",
  juniper_vjunosswitch: "ge-0/0/{n:0}",
  // eth1-eth3 are reserved; data interfaces start at eth4.
  juniper_cjunosevolved: "eth{n:4}",
  nvidia_cumulusvx: "swp{n}",
  // Legacy container kind, still accepted by containerlab.
  cumulus_cvx: "swp{n}",
  arrcus_arcos: "swp{n}",
  // port1 is the management interface; data interfaces start at port2.
  fortinet_fortigate: "port{n:2}",
  fortinet_fortiproxy: "port{n:2}",
  // SAOS ports are plain numbers.
  ciena_saos: "{n}",
  "f5_bigip-ve": "1.{n}",
  aruba_aoscx: "1/1/{n}",
  dell_ftosv: "ethernet1/1/{n}",
  paloalto_panos: "Ethernet1/{n}",
  // ether1 is the management interface; data interfaces start at ether2.
  mikrotik_ros: "ether{n:2}",
  freebsd: "vtnet{n}",
  openbsd: "vio{n}",
  // containerlab only accepts port1..port9.
  spirent_stc: "port{n:1-9}"
};
