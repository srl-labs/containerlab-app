// IOL groups interfaces in slots of four ports (e0/0 is management), up to slot 9.
const CISCO_IOL_INTERFACE_PATTERN = [
  "e0/{n:1-3}",
  ...Array.from({ length: 9 }, (_, index) => `e${index + 1}/{n:0-3}`)
].join(",");

export const DEFAULT_INTERFACE_PATTERNS: Record<string, string> = {
  nokia_srlinux: "e1-{n}",
  nokia_srsim: "1/1/c{n}/1",
  nokia_sros: "1/1/{n}",
  cisco_xrd: "Gi0-0-0-{n}",
  cisco_xrv: "Gi0/0/0/{n}",
  cisco_xrv9k: "Gi0/0/0/{n}",
  // Gi1 is the management interface; data interfaces start at Gi2.
  cisco_csr1000v: "Gi{n:2}",
  cisco_c8000v: "Gi{n:2}",
  cisco_cat9kv: "Gi1/0/{n}",
  cisco_iol: CISCO_IOL_INTERFACE_PATTERN,
  // Cisco 8000 only accepts Fi0_0_0_X, Hu0_0_0_X or FH0_0_0_X; the 8201-32FH image has 400G ports.
  cisco_c8000: "FH0_0_0_{n:0}",
  cumulus_cvx: "swp{n}",
  arrcus_arcos: "swp{n}",
  // containerlab only accepts port1..port9.
  spirent_stc: "port{n:1-9}",
  // eth1-eth3 are reserved; data interfaces start at eth4.
  juniper_cjunosevolved: "eth{n:4}"
};
