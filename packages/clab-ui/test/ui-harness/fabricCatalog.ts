/** The engine's report catalog, without its schemas, as a real engine answered. */
import type { FabricReportSpec } from "../../src/webviews/fabric/fabricTypes";

export const FABRIC_CATALOG: FabricReportSpec[] = [
 {
  "name": "bgp-peers",
  "help": "BGP peers and their status",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "ipv4-rib",
  "help": "IPv4 route table",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": [
   {
    "name": "address",
    "help": "longest-prefix match: the route each instance has to this address (10.0.0.1)"
   }
  ]
 },
 {
  "name": "ipv6-rib",
  "help": "IPv6 route table",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": [
   {
    "name": "address",
    "help": "longest-prefix match: the route each instance has to this address (2001:db8::1)"
   }
  ]
 },
 {
  "name": "tunnel-table",
  "help": "IP tunnel table (LDP, SR-ISIS, VXLAN...)",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "static-routes",
  "help": "Static routes",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "bgp-rib-evpn-1",
  "help": "BGP RIB, EVPN route type 1",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "esi",
    "help": "ESI",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   },
   {
    "name": "ethernet_tag_id",
    "help": "EVPN tag",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "esi",
   "route_distinguisher",
   "ethernet_tag_id"
  ],
  "rib_evpn": true
 },
 {
  "name": "bgp-rib-evpn-2",
  "help": "BGP RIB, EVPN route type 2",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "mac_address",
    "help": "MAC; gNMI key match, * allowed",
    "default": ""
   },
   {
    "name": "ip_address",
    "help": "host IP",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   },
   {
    "name": "ethernet_tag_id",
    "help": "EVPN tag",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "mac_address",
   "ip_address",
   "route_distinguisher",
   "ethernet_tag_id"
  ],
  "rib_evpn": true
 },
 {
  "name": "bgp-rib-evpn-3",
  "help": "BGP RIB, EVPN route type 3",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "originating_router",
    "help": "originator",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   },
   {
    "name": "ethernet_tag_id",
    "help": "EVPN tag",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "originating_router",
   "route_distinguisher",
   "ethernet_tag_id"
  ],
  "rib_evpn": true
 },
 {
  "name": "bgp-rib-evpn-4",
  "help": "BGP RIB, EVPN route type 4",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "esi",
    "help": "ESI",
    "default": ""
   },
   {
    "name": "originating_router",
    "help": "originator",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "esi",
   "originating_router",
   "route_distinguisher"
  ],
  "rib_evpn": true
 },
 {
  "name": "bgp-rib-evpn-5",
  "help": "BGP RIB, EVPN route type 5",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "ip_prefix",
    "help": "prefix, e.g. 10.1.0.0/24",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   },
   {
    "name": "ethernet_tag_id",
    "help": "EVPN tag",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "ip_prefix",
   "route_distinguisher",
   "ethernet_tag_id"
  ],
  "rib_evpn": true
 },
 {
  "name": "bgp-rib-evpn",
  "help": "BGP RIB, EVPN (all route types)",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "route_type",
    "help": "EVPN route type to read (empty: every type)",
    "default": "",
    "choices": [
     "1",
     "2",
     "3",
     "4",
     "5"
    ]
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "esi",
    "help": "ESI",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   },
   {
    "name": "ethernet_tag_id",
    "help": "EVPN tag",
    "default": ""
   },
   {
    "name": "mac_address",
    "help": "MAC; gNMI key match, * allowed",
    "default": ""
   },
   {
    "name": "ip_address",
    "help": "host IP",
    "default": ""
   },
   {
    "name": "originating_router",
    "help": "originator",
    "default": ""
   },
   {
    "name": "ip_prefix",
    "help": "prefix, e.g. 10.1.0.0/24",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "esi",
   "route_distinguisher",
   "ethernet_tag_id",
   "mac_address",
   "ip_address",
   "originating_router",
   "ip_prefix"
  ],
  "rib_evpn": true
 },
 {
  "name": "bgp-rib-ipv4-unicast",
  "help": "BGP RIB, ipv4-unicast",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "prefix",
    "help": "prefix, e.g. 10.0.0.0/8",
    "default": ""
   },
   {
    "name": "origin_protocol",
    "help": "e.g. bgp",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "prefix",
   "origin_protocol"
  ],
  "rib_evpn": false
 },
 {
  "name": "bgp-rib-ipv6-unicast",
  "help": "BGP RIB, ipv6-unicast",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "prefix",
    "help": "prefix, e.g. 10.0.0.0/8",
    "default": ""
   },
   {
    "name": "origin_protocol",
    "help": "e.g. bgp",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "prefix",
   "origin_protocol"
  ],
  "rib_evpn": false
 },
 {
  "name": "bgp-rib-l3vpn-ipv4-unicast",
  "help": "BGP RIB, l3vpn-ipv4-unicast",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "prefix",
    "help": "prefix, e.g. 10.0.0.0/8",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "prefix",
   "route_distinguisher"
  ],
  "rib_evpn": false
 },
 {
  "name": "bgp-rib-l3vpn-ipv6-unicast",
  "help": "BGP RIB, l3vpn-ipv6-unicast",
  "streamed": false,
  "hidden": true,
  "eventful": true,
  "params": [
   {
    "name": "ni",
    "help": "network-instance to read (empty: every instance)",
    "default": ""
   },
   {
    "name": "paths",
    "help": "used: the paths the node uses or picked as best; all: every path received",
    "default": "used",
    "choices": [
     "used",
     "all"
    ]
   },
   {
    "name": "direction",
    "help": "received: all paths from the peer; active: used or best; advertised: sent (rib-out)",
    "default": "",
    "choices": [
     "received",
     "active",
     "advertised"
    ]
   },
   {
    "name": "neighbor",
    "help": "BGP peer address to filter routes on",
    "default": ""
   },
   {
    "name": "list_all",
    "help": "all: every route on every node \u2014 slow on large fabrics; use route keys instead",
    "default": "",
    "choices": [
     "all"
    ]
   },
   {
    "name": "prefix",
    "help": "prefix, e.g. 10.0.0.0/8",
    "default": ""
   },
   {
    "name": "route_distinguisher",
    "help": "RD; e.g. 10.0.1.2:*",
    "default": ""
   }
  ],
  "needs_query": true,
  "rib_keys": [
   "prefix",
   "route_distinguisher"
  ],
  "rib_evpn": false
 },
 {
  "name": "bfd",
  "help": "BFD sessions and how often they failed",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "isis",
  "help": "IS-IS interfaces and adjacencies",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "ospf",
  "help": "OSPF interfaces and neighbors",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "resources",
  "help": "CPU, memory and forwarding-table utilization",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "components",
  "help": "Cards, fabric modules, fans and power supplies",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "transceivers",
  "help": "Optics with their light levels and DOM alarms",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "ni",
  "help": "Network instances and their interfaces",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "subif",
  "help": "Sub-interfaces of nodes",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "lag",
  "help": "LAGs of nodes",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "ifstats",
  "help": "Per-interface rates from two samples",
  "streamed": true,
  "hidden": false,
  "eventful": false,
  "params": []
 },
 {
  "name": "mac",
  "help": "MAC table",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "arp",
  "help": "ARP table",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "nd",
  "help": "IPv6 neighbors",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "es",
  "help": "Ethernet segments",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "es-dest",
  "help": "ES destinations on the bridge table",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "vxlan",
  "help": "VXLAN tunnel interfaces and unicast destinations",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "irb",
  "help": "IRB sub-interfaces",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "lldp",
  "help": "LLDP neighbors",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "routing-pol",
  "help": "Routing policies and the sets they match on",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "services",
  "help": "Every network-instance as the service it is",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "bridge-domains",
  "help": "The mac-vrfs: access ports, segments, irbs and VNIs",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "routers",
  "help": "The ip-vrfs: the mac-vrfs behind them, routed ports, BGP sessions",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "sys-info",
  "help": "System information of nodes",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 },
 {
  "name": "config-commits",
  "help": "Commits each node logged to its configuration",
  "streamed": true,
  "hidden": false,
  "eventful": true,
  "params": []
 }
];
