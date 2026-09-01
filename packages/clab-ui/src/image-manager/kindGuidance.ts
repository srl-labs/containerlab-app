import type { KindImageGuidance, KindImagePreparation } from "./types";

const KINDS_DOCS_URL = "https://containerlab.dev/manual/kinds/";
const VRNETLAB_DOCS_URL = "https://containerlab.dev/manual/vrnetlab/";

type GuidanceInput = Partial<
  Omit<KindImageGuidance, "kind" | "title" | "docsUrl" | "repositoryHints" | "recommendedImages">
> & {
  title: string;
  docsSlug?: string;
  recommendedImages?: string[];
  repositoryHints?: string[];
};

const GUIDANCE_BY_KIND: Record<string, GuidanceInput> = {
  nokia_srlinux: {
    title: "Nokia SR Linux",
    docsSlug: "srl",
    recommendedImages: ["ghcr.io/nokia/srlinux"],
    repositoryHints: ["ghcr.io/nokia/srlinux", "nokia/srlinux", "srlinux"],
    guidance: "Public SR Linux image on GHCR. Use a release tag when you want repeatable labs.",
    pullable: true
  },
  nokia_srsim: {
    title: "Nokia SR OS (SR-SIM)",
    docsSlug: "sros",
    recommendedImages: ["nokia_srsim:<version>"],
    repositoryHints: ["nokia_srsim"],
    guidance: "Download the SR-SIM container archive from the Nokia Support Portal, load it with `docker load`, then reference nokia_srsim:<version>.",
    pullable: false
  },
  nokia_sros: {
    title: "Nokia SR OS VM",
    docsSlug: "vr-sros",
    recommendedImages: ["vrnetlab/nokia_sros:<version>", "nokia_sros:<version>"],
    repositoryHints: ["vrnetlab/nokia_sros", "nokia_sros", "vr-sros", "sros"],
    guidance: "Build the SR OS VM container with vrnetlab (`make build`) — the resulting image is named vrnetlab/nokia_sros:<version>. You can also push it to a private registry.",
    pullable: false
  },
  arista_ceos: {
    title: "Arista cEOS",
    docsSlug: "ceos",
    recommendedImages: ["ceos:<version>"],
    repositoryHints: ["ceos", "arista/ceos"],
    guidance: "Download the cEOS-lab tarball from Arista (free arista.com account), then `docker import cEOS64-lab-<version>.tar.xz ceos:<version>`.",
    pullable: false
  },
  arista_veos: {
    title: "Arista vEOS",
    docsSlug: "vr-veos",
    recommendedImages: ["vrnetlab/arista_veos:<version>"],
    repositoryHints: ["vrnetlab/arista_veos", "vr-veos", "veos"],
    guidance: "Build a vEOS container with vrnetlab from the Arista vEOS qcow2 — the resulting image is named vrnetlab/arista_veos:<version>.",
    pullable: false
  },
  linux: {
    title: "Linux",
    docsSlug: "linux",
    recommendedImages: ["alpine:latest", "ghcr.io/srl-labs/network-multitool:latest"],
    repositoryHints: [
      "ghcr.io/srl-labs/network-multitool",
      "network-multitool",
      "alpine",
      "ubuntu",
      "debian",
      "frrouting/frr"
    ],
    guidance: "Run any Linux container image. alpine is the docs default; network-multitool is a popular choice for clients with a full networking toolkit.",
    pullable: true
  },
  bridge: {
    title: "Linux Bridge",
    docsSlug: "bridge",
    recommendedImages: [],
    repositoryHints: [],
    imageRequired: false,
    guidance: "No container image is required. This kind represents a host Linux bridge.",
    pullable: false
  },
  "ovs-bridge": {
    title: "Open vSwitch Bridge",
    docsSlug: "ovs-bridge",
    recommendedImages: [],
    repositoryHints: [],
    imageRequired: false,
    guidance: "No container image is required. This kind represents an OVS bridge on the host.",
    pullable: false
  },
  "ext-container": {
    title: "External Container",
    docsSlug: "ext-container",
    recommendedImages: [],
    repositoryHints: [],
    imageRequired: false,
    guidance: "No image is managed by containerlab. This kind links to an already existing container.",
    pullable: false
  },
  host: {
    title: "Host",
    docsSlug: "host",
    recommendedImages: [],
    repositoryHints: [],
    imageRequired: false,
    guidance: "No container image is required. This kind represents the containerlab host itself.",
    pullable: false
  },
  border0: {
    title: "Border0",
    recommendedImages: [],
    repositoryHints: [],
    imageRequired: false,
    guidance: "No standalone image is required for this special connectivity kind.",
    pullable: false
  },
  "k8s-kind": {
    title: "Kubernetes in Docker",
    docsSlug: "k8s-kind",
    recommendedImages: ["kindest/node:<version>"],
    repositoryHints: ["kindest/node"],
    guidance: "Containerlab spins up a kind cluster — set image to a kindest/node tag matching the Kubernetes version you want.",
    pullable: true
  },
  juniper_crpd: {
    title: "Juniper cRPD",
    docsSlug: "crpd",
    recommendedImages: ["crpd:<version>"],
    repositoryHints: ["crpd", "juniper/crpd"],
    guidance: "Download cRPD from Juniper's support portal (active service contract required) and `docker load` the resulting tarball — it is tagged crpd:<version>.",
    pullable: false
  },
  juniper_vmx: {
    title: "Juniper vMX",
    docsSlug: "vr-vmx",
    recommendedImages: ["vrnetlab/juniper_vmx:<version>"],
    repositoryHints: ["vrnetlab/juniper_vmx", "vr-vmx", "vmx"],
    guidance: "Build a vMX container with vrnetlab from the Juniper vMX bundle — the resulting image is named vrnetlab/juniper_vmx:<version>.",
    pullable: false
  },
  juniper_vqfx: {
    title: "Juniper vQFX",
    docsSlug: "vr-vqfx",
    recommendedImages: ["vrnetlab/juniper_vqfx:<version>"],
    repositoryHints: ["vrnetlab/juniper_vqfx", "vr-vqfx", "vqfx"],
    guidance: "Build a vQFX container with vrnetlab from the Juniper vQFX qcow2 — the resulting image is named vrnetlab/juniper_vqfx:<version>.",
    pullable: false
  },
  juniper_vsrx: {
    title: "Juniper vSRX",
    docsSlug: "vr-vsrx",
    recommendedImages: ["vrnetlab/juniper_vsrx:<version>"],
    repositoryHints: ["vrnetlab/juniper_vsrx", "vr-vsrx", "vsrx"],
    guidance: "Build a vSRX container with vrnetlab from the Juniper vSRX qcow2 — the resulting image is named vrnetlab/juniper_vsrx:<version>.",
    pullable: false
  },
  juniper_vjunosrouter: {
    title: "Juniper vJunos-router",
    docsSlug: "vr-vjunosrouter",
    recommendedImages: ["vrnetlab/juniper_vjunosrouter:<version>"],
    repositoryHints: ["vrnetlab/juniper_vjunosrouter", "vr-vjunos-router", "vjunosrouter"],
    guidance: "Build a vJunos-router container with vrnetlab from the qcow2 — the resulting image is named vrnetlab/juniper_vjunosrouter:<version>.",
    pullable: false
  },
  juniper_vjunosswitch: {
    title: "Juniper vJunos-switch",
    docsSlug: "vr-vjunosswitch",
    recommendedImages: ["vrnetlab/juniper_vjunosswitch:<version>"],
    repositoryHints: ["vrnetlab/juniper_vjunosswitch", "vr-vjunos-switch", "vjunosswitch"],
    guidance: "Build a vJunos-switch container with vrnetlab from the qcow2 — the resulting image is named vrnetlab/juniper_vjunosswitch:<version>.",
    pullable: false
  },
  juniper_vjunosevolved: {
    title: "Juniper vJunosEvolved",
    docsSlug: "vr-vjunosevolved",
    recommendedImages: ["vrnetlab/juniper_vjunosevolved:<version>"],
    repositoryHints: ["vrnetlab/juniper_vjunosevolved", "vr-vjunosevolved", "vjunosevolved"],
    guidance: "Build a vJunosEvolved container with vrnetlab from the qcow2 — the resulting image is named vrnetlab/juniper_vjunosevolved:<version>.",
    pullable: false
  },
  juniper_cjunosevolved: {
    title: "Juniper cJunosEvolved",
    docsSlug: "cjunosevolved",
    recommendedImages: ["cjunosevolved:<version>"],
    repositoryHints: ["cjunosevolved", "vr-cjunosevolved"],
    guidance: "Download the cJunosEvolved container image freely from the Juniper support portal, then `docker load` it — the image is tagged cjunosevolved:<version>.",
    pullable: false
  },
  cisco_xrd: {
    title: "Cisco XRd",
    docsSlug: "xrd",
    recommendedImages: ["xrd-control-plane:<version>", "xrd-vrouter:<version>"],
    repositoryHints: ["xrd-control-plane", "xrd-vrouter", "xrd"],
    guidance: "Download XRd Control Plane or XRd vRouter from Cisco (active service account required) and load it locally — set type: xrd-control-plane or type: xrd-vrouter to pick the form factor.",
    pullable: false
  },
  cisco_xrv: {
    title: "Cisco XRv",
    docsSlug: "vr-xrv",
    recommendedImages: ["vrnetlab/cisco_xrv:<version>"],
    repositoryHints: ["vrnetlab/cisco_xrv", "vr-xrv", "xrv"],
    guidance: "Build a Cisco XRv container with vrnetlab from your licensed XRv qcow2 — the resulting image is named vrnetlab/cisco_xrv:<version>.",
    pullable: false
  },
  cisco_xrv9k: {
    title: "Cisco XRv9k",
    docsSlug: "vr-xrv9k",
    recommendedImages: ["vrnetlab/cisco_xrv9k:<version>"],
    repositoryHints: ["vrnetlab/cisco_xrv9k", "vr-xrv9k", "xrv9k"],
    guidance: "Build a Cisco XRv9k container with vrnetlab from your licensed XRv9k qcow2 — the resulting image is named vrnetlab/cisco_xrv9k:<version>.",
    pullable: false
  },
  cisco_csr1000v: {
    title: "Cisco CSR1000v",
    docsSlug: "vr-csr",
    recommendedImages: ["vrnetlab/cisco_csr1000v:<version>"],
    repositoryHints: ["vrnetlab/cisco_csr1000v", "vr-csr", "csr1000v"],
    guidance: "Build a CSR1000v container with vrnetlab from your licensed CSR qcow2 — the resulting image is named vrnetlab/cisco_csr1000v:<version>.",
    pullable: false
  },
  cisco_n9kv: {
    title: "Cisco Nexus 9000v",
    docsSlug: "vr-n9kv",
    recommendedImages: ["vrnetlab/cisco_n9kv:<version>"],
    repositoryHints: ["vrnetlab/cisco_n9kv", "vr-n9kv", "n9kv", "nexus9000v"],
    guidance: "Build a Nexus 9000v container with vrnetlab from the Cisco N9000v qcow2 — the resulting image is named vrnetlab/cisco_n9kv:<version>.",
    pullable: false
  },
  cisco_c8000: {
    title: "Cisco 8000",
    docsSlug: "c8000",
    recommendedImages: ["8201-32fh-clab:<version>"],
    repositoryHints: ["8201-32fh-clab", "c8000"],
    guidance: "Cisco 8000 ships as a containerlab-ready image (e.g. 8201-32fh-clab:<version>) provided by Cisco. Set image-pull-policy: Never since it is loaded locally.",
    pullable: false
  },
  cisco_c8000v: {
    title: "Cisco c8000v",
    docsSlug: "vr-c8000v",
    recommendedImages: ["vrnetlab/cisco_c8000v:<version>", "vrnetlab/vr-c8000v:<version>"],
    repositoryHints: ["vrnetlab/cisco_c8000v", "vrnetlab/vr-c8000v", "c8000v"],
    guidance: "Build a Cisco c8000v container with vrnetlab from your licensed c8000v qcow2 — the resulting image is named vrnetlab/cisco_c8000v:<version>.",
    pullable: false
  },
  cisco_cat9kv: {
    title: "Cisco Catalyst 9000v",
    docsSlug: "vr-cat9kv",
    recommendedImages: ["vrnetlab/cisco_cat9kv:<version>", "vrnetlab/vr-cat9kv:<version>"],
    repositoryHints: ["vrnetlab/cisco_cat9kv", "vrnetlab/vr-cat9kv", "cat9kv"],
    guidance: "Build a Catalyst 9000v container with vrnetlab from your licensed Cat9kv qcow2 — the resulting image is named vrnetlab/cisco_cat9kv:<version>.",
    pullable: false
  },
  cisco_iol: {
    title: "Cisco IOL",
    docsSlug: "cisco_iol",
    recommendedImages: ["vrnetlab/cisco_iol:<version>", "vrnetlab/cisco_iol:L2-<version>"],
    repositoryHints: ["vrnetlab/cisco_iol", "cisco_iol", "ioll2", "ioll3", "iol"],
    guidance: "Build IOL with vrnetlab from your licensed IOL/IOL-L2 binaries — the resulting image is vrnetlab/cisco_iol:<version>. Set type: l2 in your topology when using the IOL-L2 image.",
    pullable: false
  },
  cisco_asav: {
    title: "Cisco ASAv",
    docsSlug: "cisco_asav",
    recommendedImages: ["vrnetlab/cisco_asav:<version>"],
    repositoryHints: ["vrnetlab/cisco_asav", "vr-asav", "asav"],
    guidance: "Build a Cisco ASAv container with vrnetlab from your licensed ASAv qcow2 — the resulting image is named vrnetlab/cisco_asav:<version>.",
    pullable: false
  },
  cisco_ftdv: {
    title: "Cisco FTDv",
    docsSlug: "vr-ftdv",
    recommendedImages: ["vrnetlab/cisco_ftdv:<version>"],
    repositoryHints: ["vrnetlab/cisco_ftdv", "vr-ftdv", "ftdv"],
    guidance: "Build a Cisco FTDv container with vrnetlab from your licensed FTDv qcow2 — the resulting image is named vrnetlab/cisco_ftdv:<version>.",
    pullable: false
  },
  cisco_vios: {
    title: "Cisco vIOS",
    docsSlug: "cisco_vios",
    recommendedImages: ["vrnetlab/cisco_vios:<version>", "vrnetlab/cisco_vios:L2-<version>"],
    repositoryHints: ["vrnetlab/cisco_vios", "vr-vios", "vios"],
    guidance: "Build a Cisco vIOS container with vrnetlab from your licensed vIOS image — the resulting image is named vrnetlab/cisco_vios:<version>.",
    pullable: false
  },
  cisco_sdwan: {
    title: "Cisco SD-WAN",
    docsSlug: "cisco_sdwan",
    recommendedImages: [
      "vrnetlab/cisco_sdwan-manager:<version>",
      "vrnetlab/cisco_sdwan-controller:<version>",
      "vrnetlab/cisco_sdwan-validator:<version>"
    ],
    repositoryHints: [
      "vrnetlab/cisco_sdwan-manager",
      "vrnetlab/cisco_sdwan-controller",
      "vrnetlab/cisco_sdwan-validator",
      "cisco_sdwan"
    ],
    guidance: "Build the Cisco SD-WAN Manager, Controller and Validator containers with vrnetlab from the licensed SD-WAN qcow2 images.",
    pullable: false
  },
  "sonic-vs": {
    title: "SONiC VS",
    docsSlug: "sonic-vs",
    recommendedImages: ["docker-sonic-vs:<version>"],
    repositoryHints: ["docker-sonic-vs", "sonic-vs"],
    guidance: "Download a SONiC VS image from sonic.software or the Azure pipeline build artifacts and `docker load` it — the image is tagged docker-sonic-vs:<version>.",
    pullable: false
  },
  "sonic-vm": {
    title: "SONiC VM",
    docsSlug: "sonic-vm",
    recommendedImages: ["vrnetlab/sonic_sonic-vm:<version>"],
    repositoryHints: ["vrnetlab/sonic_sonic-vm", "vr-sonic", "sonic-vm", "sonic"],
    guidance: "Build a SONiC VM container with vrnetlab from a SONiC qcow2 — the resulting image is named vrnetlab/sonic_sonic-vm:<version>.",
    pullable: false
  },
  dell_ftosv: {
    title: "Dell FTOS10v",
    docsSlug: "vr-ftosv",
    recommendedImages: ["vrnetlab/dell_ftosv:<version>"],
    repositoryHints: ["vrnetlab/dell_ftosv", "vr-ftosv", "ftos10v"],
    guidance: "Build a Dell FTOS10v container with vrnetlab from the FTOS qcow2 — the resulting image is named vrnetlab/dell_ftosv:<version>.",
    pullable: false
  },
  dell_sonic: {
    title: "Dell Enterprise SONiC",
    docsSlug: "dell_sonic",
    recommendedImages: ["vrnetlab/dell_sonic:<version>"],
    repositoryHints: ["vrnetlab/dell_sonic", "dell-sonic", "dell_sonic"],
    guidance: "Build a Dell Enterprise SONiC container with vrnetlab from the Dell SONiC qcow2 — the resulting image is named vrnetlab/dell_sonic:<version>.",
    pullable: false
  },
  cumulus_cvx: {
    title: "Cumulus VX",
    docsSlug: "cvx",
    recommendedImages: ["networkop/cx:<version>"],
    repositoryHints: ["networkop/cx", "cumulusvx", "cumulus-cvx", "cvx"],
    guidance: "NVIDIA discontinued Cumulus VX after v5.12.1. Use the community networkop/cx image (or NVIDIA AIR for new work). Default mode launches a Firecracker micro-VM via the ignite runtime.",
    pullable: true
  },
  aruba_aoscx: {
    title: "Aruba AOS-CX",
    docsSlug: "vr-aoscx",
    recommendedImages: ["vrnetlab/aruba_aoscx:<version>"],
    repositoryHints: ["vrnetlab/aruba_aoscx", "vr-aoscx", "aoscx"],
    guidance: "Build an Aruba AOS-CX container with vrnetlab from the AOS-CX qcow2 — the resulting image is named vrnetlab/aruba_aoscx:<version>.",
    pullable: false
  },
  mikrotik_ros: {
    title: "MikroTik RouterOS",
    docsSlug: "vr-ros",
    recommendedImages: ["vrnetlab/mikrotik_ros:<version>"],
    repositoryHints: ["vrnetlab/mikrotik_ros", "vr-ros", "routeros", "mikrotik"],
    guidance: "Build a MikroTik RouterOS CHR container with vrnetlab from the CHR image — the resulting image is named vrnetlab/mikrotik_ros:<version>.",
    pullable: false
  },
  huawei_vrp: {
    title: "Huawei VRP",
    docsSlug: "huawei_vrp",
    recommendedImages: ["vrnetlab/huawei_vrp:<version>"],
    repositoryHints: ["vrnetlab/huawei_vrp", "vr-vrp", "huawei-vrp", "vrp"],
    guidance: "Build a Huawei VRP container with vrnetlab from the licensed VRP image — the resulting image is named vrnetlab/huawei_vrp:<version>.",
    pullable: false
  },
  ipinfusion_ocnos: {
    title: "IPInfusion OcNOS",
    docsSlug: "ipinfusion-ocnos",
    recommendedImages: ["vrnetlab/ipinfusion_ocnos:<version>"],
    repositoryHints: ["vrnetlab/ipinfusion_ocnos", "vr-ocnos", "ocnos"],
    guidance: "Build an IPInfusion OcNOS container with vrnetlab from the OcNOS qcow2 — the resulting image is named vrnetlab/ipinfusion_ocnos:<version>.",
    pullable: false
  },
  checkpoint_cloudguard: {
    title: "Check Point CloudGuard",
    docsSlug: "checkpoint_cloudguard",
    recommendedImages: ["vrnetlab/checkpoint_cloudguard:<version>"],
    repositoryHints: ["vrnetlab/checkpoint_cloudguard", "vr-cloudguard", "cloudguard"],
    guidance: "Build a Check Point CloudGuard container with vrnetlab from the CloudGuard qcow2 — the resulting image is named vrnetlab/checkpoint_cloudguard:<version>.",
    pullable: false
  },
  fortinet_fortigate: {
    title: "Fortinet Fortigate",
    docsSlug: "fortinet_fortigate",
    recommendedImages: ["vrnetlab/fortinet_fortigate:<version>"],
    repositoryHints: ["vrnetlab/fortinet_fortigate", "vr-fortigate", "fortigate"],
    guidance: "Build a Fortinet Fortigate container with vrnetlab from the Fortigate qcow2 — the resulting image is named vrnetlab/fortinet_fortigate:<version>.",
    pullable: false
  },
  "f5_bigip-ve": {
    title: "F5 BIG-IP VE",
    docsSlug: "f5-bigip-ve",
    recommendedImages: ["vrnetlab/f5_bigip:<version>"],
    repositoryHints: ["vrnetlab/f5_bigip", "vr-f5-bigip", "bigip", "f5"],
    guidance: "Build an F5 BIG-IP VE container with vrnetlab from the BIG-IP qcow2 — the resulting image is named vrnetlab/f5_bigip:<version>.",
    pullable: false
  },
  paloalto_panos: {
    title: "Palo Alto PAN-OS",
    docsSlug: "vr-pan",
    recommendedImages: ["vrnetlab/paloalto_panos:<version>"],
    repositoryHints: ["vrnetlab/paloalto_panos", "vr-panos", "panos"],
    guidance: "Build a Palo Alto PAN-OS container with vrnetlab from the licensed PAN-OS qcow2 — the resulting image is named vrnetlab/paloalto_panos:<version>.",
    pullable: false
  },
  "keysight_ixia-c-one": {
    title: "Keysight ixia-c-one",
    docsSlug: "keysight_ixia-c-one",
    recommendedImages: ["ghcr.io/open-traffic-generator/ixia-c-one:latest"],
    repositoryHints: ["ghcr.io/open-traffic-generator/ixia-c-one", "ixia-c-one"],
    guidance: "Pull the public ixia-c-one traffic generator image directly from GHCR.",
    pullable: true
  },
  rare: {
    title: "RARE/freeRtr",
    docsSlug: "rare-freertr",
    recommendedImages: ["ghcr.io/rare-freertr/freertr-containerlab:latest"],
    repositoryHints: [
      "ghcr.io/rare-freertr/freertr-containerlab",
      "rare-freertr/freertr-containerlab",
      "freertr",
      "rare"
    ],
    guidance: "Pull the RARE/freeRtr containerlab image directly from GHCR — works as a lightweight routing daemon.",
    pullable: true
  },
  fdio_vpp: {
    title: "FD.io VPP",
    docsSlug: "fdio_vpp",
    recommendedImages: ["git.ipng.ch/ipng/vpp-containerlab:latest"],
    repositoryHints: ["git.ipng.ch/ipng/vpp-containerlab", "vpp-containerlab", "fdio-vpp", "vpp"],
    guidance: "Pull the FD.io VPP containerlab image from IPng's package registry (linux/amd64 only). Bundles VPP, vppcfg and Bird2 control plane.",
    pullable: true
  },
  arrcus_arcos: {
    title: "Arrcus ArcOS",
    docsSlug: "arrcus_arcos",
    recommendedImages: ["arcos:<version>"],
    repositoryHints: ["arcos", "vr-arcos", "arrcus"],
    guidance: "Obtain the ArcOS container image from Arrcus and `docker load` it locally.",
    pullable: false
  },
  vyosnetworks_vyos: {
    title: "VyOS",
    docsSlug: "vyosnetworks_vyos",
    recommendedImages: ["vyos:latest"],
    repositoryHints: ["vyosnetworks/vyos", "vyos"],
    guidance: "VyOS does not publish a native container image. Build or import one from a VyOS ISO, then tag it as vyos:latest or the image name used by your topology.",
    pullable: false
  },
  freebsd: {
    title: "FreeBSD",
    docsSlug: "freebsd",
    recommendedImages: ["vrnetlab/freebsd_freebsd:<version>"],
    repositoryHints: ["vrnetlab/freebsd_freebsd", "vr-freebsd", "freebsd"],
    guidance: "Build a FreeBSD container with vrnetlab from a FreeBSD VM image — the resulting image is named vrnetlab/freebsd_freebsd:<version>.",
    pullable: false
  },
  openbsd: {
    title: "OpenBSD",
    docsSlug: "openbsd",
    recommendedImages: ["vrnetlab/openbsd_openbsd:<version>"],
    repositoryHints: ["vrnetlab/openbsd_openbsd", "vr-openbsd", "openbsd"],
    guidance: "Build an OpenBSD container with vrnetlab from an OpenBSD VM image — the resulting image is named vrnetlab/openbsd_openbsd:<version>.",
    pullable: false
  },
  openwrt: {
    title: "OpenWRT",
    docsSlug: "openwrt",
    recommendedImages: ["vrnetlab/openwrt_openwrt:<version>"],
    repositoryHints: ["vrnetlab/openwrt_openwrt", "vr-openwrt", "openwrt"],
    guidance: "Build an OpenWRT container with vrnetlab from the OpenWRT VM image — the resulting image is named vrnetlab/openwrt_openwrt:<version>.",
    pullable: false
  },
  generic_vm: {
    title: "Generic VM",
    docsSlug: "generic_vm",
    recommendedImages: ["vrnetlab/generic_vm:<version>"],
    repositoryHints: ["vrnetlab/generic_vm", "vr-generic", "generic_vm"],
    guidance: "Wrap any VM image as a containerlab-compatible container using vrnetlab's generic_vm template.",
    pullable: false
  },
  "6wind_vsr": {
    title: "6WIND VSR",
    docsSlug: "6wind_vsr",
    recommendedImages: ["6wind/vsr:<version>"],
    repositoryHints: ["6wind/vsr", "vsr", "6wind"],
    guidance: "Pull the 6WIND VSR container image from your 6WIND customer portal (free evaluation images available with registration).",
    pullable: false
  },
  ostinato: {
    title: "Ostinato",
    docsSlug: "ostinato",
    recommendedImages: ["ostinato/ostinato:<tag>"],
    repositoryHints: ["ostinato/ostinato", "ostinato"],
    guidance: "Ostinato for containerlab is a paid offering from ostinato.org. After purchase, follow the install instructions to load the image and reference ostinato/ostinato:<tag>.",
    pullable: false
  },
  frr: {
    title: "FRRouting",
    docsSlug: "linux",
    recommendedImages: ["frrouting/frr:latest"],
    repositoryHints: ["frrouting/frr", "frr"],
    guidance: "FRRouting is run via the linux kind. Pull frrouting/frr from Docker Hub directly.",
    pullable: true
  }
};

function titleFromKind(kind: string): string {
  return kind
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isVrnetlabImageReference(image: string): boolean {
  const repository = image.split("@")[0]?.split(":")[0]?.toLowerCase() ?? "";
  return repository.startsWith("vr-") || repository.includes("/vr-") || repository.includes("vrnetlab");
}

function inferPreparation(guidance: GuidanceInput): KindImagePreparation {
  const recommendedImages = guidance.recommendedImages ?? [];
  const guidanceText = guidance.guidance?.toLowerCase() ?? "";

  if (guidance.imageRequired === false) {
    return {
      mode: "none",
      label: "No image",
      details: "Containerlab does not pull or run a separate NOS image for this kind."
    };
  }

  if (
    recommendedImages.some(isVrnetlabImageReference) ||
    guidanceText.includes("vrnetlab")
  ) {
    return {
      mode: "vrnetlab",
      label: "vrnetlab build",
      details: "Download the vendor VM image, build it with srl-labs/vrnetlab, then load or tag the resulting container image for containerlab.",
      docsUrl: VRNETLAB_DOCS_URL
    };
  }

  if (guidance.pullable) {
    return {
      mode: "direct-pull",
      label: "Registry pull",
      details: "This image can be pulled directly from a registry. Prefer a fixed tag or digest for repeatable labs."
    };
  }

  if (recommendedImages.length > 0) {
    return {
      mode: "vendor-import",
      label: "Vendor image",
      details: "Download the vendor-provided image, import or load it into the runtime, then use the shown image name or your own pinned tag."
    };
  }

  return {
    mode: "docs",
    label: "Check docs",
    details: "Use the Containerlab kind documentation to identify the supported image source and naming pattern."
  };
}

export function getKindImageGuidance(kind: string): KindImageGuidance {
  const guidance = GUIDANCE_BY_KIND[kind];
  if (!guidance) {
    const fallbackGuidance: GuidanceInput = {
      title: titleFromKind(kind),
      recommendedImages: [],
      repositoryHints: [kind],
      guidance: "Check the Containerlab kind documentation for the expected image source, then pin the image reference you use in your topologies.",
      pullable: false
    };
    return {
      kind,
      title: fallbackGuidance.title,
      imageRequired: true,
      recommendedImages: fallbackGuidance.recommendedImages ?? [],
      repositoryHints: fallbackGuidance.repositoryHints ?? [],
      guidance: fallbackGuidance.guidance ?? "",
      preparation: inferPreparation(fallbackGuidance),
      docsUrl: KINDS_DOCS_URL,
      pullable: false
    };
  }

  return {
    kind,
    title: guidance.title,
    imageRequired: guidance.imageRequired ?? true,
    recommendedImages: guidance.recommendedImages ?? [],
    repositoryHints: guidance.repositoryHints ?? guidance.recommendedImages ?? [],
    guidance: guidance.guidance ?? "Check the Containerlab kind documentation for the image source.",
    preparation: guidance.preparation ?? inferPreparation(guidance),
    docsUrl: guidance.docsSlug ? `${KINDS_DOCS_URL}${guidance.docsSlug}/` : KINDS_DOCS_URL,
    pullable: guidance.pullable ?? false
  };
}

export function isPlaceholderImageReference(image: string): boolean {
  return image.includes("<") || image.includes(">");
}
