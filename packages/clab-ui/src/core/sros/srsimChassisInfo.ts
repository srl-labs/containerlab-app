// Copyright 2026 Nokia
// Licensed under the BSD 3-Clause License.
// SPDX-License-Identifier: BSD-3-Clause

/**
 * The hardware SR-SIM lists for each chassis: /opt/nokia/chassis_info.json of the
 * nokia_srsim image named by SRSIM_CHASSIS_INFO_RELEASE, unchanged. Containerlab
 * checks a node's components against the same file from the node's own image.
 *
 * To refresh, copy the file out of a newer image and update the release:
 *   id=$(docker create <image> /bin/true)
 *   docker cp "$id:/opt/nokia/chassis_info.json" - | tar -xO
 *   docker rm "$id"
 */
export interface RawChassisEntry {
  /** Name of the chassis whose hardware this one shares */
  alias?: string;
  cpm?: string[];
  fake_fabric?: boolean;
  /** Hardware that cannot be changed, as cpm or cpm/card */
  fixed_hw_cfg?: string;
  /** MDA types that cannot be changed, by MDA slot */
  fixed_mdas?: Record<string, string>;
  integrated?: boolean;
  /** Line card types */
  iom?: string[];
  iom_slots?: number;
  /** null: cards of this chassis take no separate MDA */
  mda?: Array<string | null>;
  redundant?: boolean;
  sfm?: string[];
  supports_extension?: boolean;
  supports_port_speed_mode?: string[];
  supports_system_profile?: boolean;
  xiom?: string[];
}

export const SRSIM_CHASSIS_INFO_RELEASE = "26.3.R1";

export const SRSIM_CHASSIS_INFO: Readonly<Record<string, RawChassisEntry>> = {
  "DMS-1-24D": {
    "fixed_hw_cfg": "cpm-1x/dms24-800g-qsfpdd-1",
    "iom_slots": 1
  },
  "ESS-12": {
    "alias": "SR-12"
  },
  "ESS-7": {
    "alias": "SR-7"
  },
  "IXR-10": {
    "cpm": [
      "cpm-ixr"
    ],
    "iom": [
      "imm36-100g-qsfp28",
      "imm48-sfp+2-qsfp28"
    ],
    "iom_slots": 8,
    "mda": [
      null
    ],
    "redundant": true,
    "sfm": [
      "sfm-ixr-10"
    ]
  },
  "IXR-6": {
    "cpm": [
      "cpm-ixr"
    ],
    "iom": [
      "imm36-100g-qsfp28",
      "imm48-sfp+2-qsfp28"
    ],
    "iom_slots": 4,
    "mda": [
      null
    ],
    "redundant": true,
    "sfm": [
      "sfm-ixr-6"
    ]
  },
  "IXR-R4": {
    "cpm": [
      "cpm-ixr-r4"
    ],
    "fixed_mdas": {
      "5": "m10-1g-sfp+2-10g-sfp+"
    },
    "iom": [
      "iom-ixr-r4"
    ],
    "iom_slots": 1,
    "mda": [
      "m6-10g-sfp++1-100g-qsfp28"
    ],
    "redundant": true
  },
  "IXR-R6": {
    "cpm": [
      "cpiom-ixr-r6"
    ],
    "integrated": true,
    "mda": [
      "m6-10g-sfp++1-100g-qsfp28"
    ],
    "redundant": true
  },
  "IXR-R6d": {
    "cpm": [
      "cpiom-ixr-r6d"
    ],
    "iom": [
      "iom-ixr-r6d"
    ],
    "iom_slots": 2,
    "mda": [
      "m1-400g-qsfpdd+1-100g-qsfp28"
    ],
    "redundant": true
  },
  "IXR-R6dl": {
    "cpm": [
      "cpiom-ixr-r6d"
    ],
    "iom": [
      "iom-ixr-r6d"
    ],
    "iom_slots": 2,
    "mda": [
      "m1-400g-qsfpdd+1-100g-qsfp28"
    ],
    "redundant": true
  },
  "IXR-e": {
    "cpm": [
      "cpm-ixr-e",
      "cpm-ixr-e/imm24-sfp++8-sfp28+2-qsfp28",
      "cpm-ixr-e-gnss/imm24-sfp++8-sfp28+2-qsfp28",
      "cpm-ixr-e/imm14-10g-sfp++4-1g-tx",
      "cpm-ixr-e-gnss/imm14-10g-sfp++4-1g-tx"
    ],
    "iom": [
      "imm24-sfp++8-sfp28+2-qsfp28",
      "cpm-ixr-e/imm24-sfp++8-sfp28+2-qsfp28",
      "cpm-ixr-e-gnss/imm24-sfp++8-sfp28+2-qsfp28",
      "cpm-ixr-e/imm14-10g-sfp++4-1g-tx",
      "cpm-ixr-e-gnss/imm14-10g-sfp++4-1g-tx"
    ],
    "iom_slots": 1,
    "mda": [
      null
    ]
  },
  "IXR-e2": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-e2",
    "integrated": true
  },
  "IXR-e2c": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-e2c",
    "integrated": true
  },
  "IXR-e2n": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-e2n/imm4-sfp+4-sfp+",
    "integrated": true
  },
  "IXR-e2n-s": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-e2n-s/imm4-sfp+4-sfp+-s",
    "integrated": true
  },
  "IXR-e3c": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-e3c/imm4-qsfp28+16-sfp28+8-sfp56",
    "integrated": true
  },
  "IXR-e3x": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-e3x/imm16-sfp112+15-sfp56+6-qsfpdd",
    "integrated": true
  },
  "IXR-ec": {
    "fake_fabric": true,
    "fixed_hw_cfg": "cpm-ixr-ec",
    "integrated": true
  },
  "IXR-s": {
    "fixed_hw_cfg": "cpm-ixr-s/imm48-sfp++6-qsfp28",
    "iom_slots": 1
  },
  "IXR-x": {
    "cpm": [
      "cpm-ixr-x",
      "cpm-ixr-x/imm32-qsfp28+4-qsfpdd",
      "cpm-ixr-x/imm6-qsfpdd+48-sfp56"
    ],
    "iom": [
      "imm6-qsfpdd+48-sfp56",
      "cpm-ixr-x/imm32-qsfp28+4-qsfpdd",
      "cpm-ixr-x/imm6-qsfpdd+48-sfp56"
    ],
    "iom_slots": 1,
    "mda": [
      null
    ]
  },
  "IXR-x3": {
    "cpm": [
      "cpm-ixr-x"
    ],
    "iom": [
      "imm36-qsfpdd"
    ],
    "iom_slots": 1,
    "mda": [
      null
    ]
  },
  "SAR-1": {
    "fixed_hw_cfg": "iom-sar",
    "integrated": true,
    "supports_system_profile": true
  },
  "SAR-Hm": {
    "fixed_hw_cfg": "cpm-sar-hm",
    "integrated": true
  },
  "SAR-Hmc": {
    "fixed_hw_cfg": "cpm-sar-hmc",
    "integrated": true
  },
  "SAR-Hx": {
    "cpm": [
      "iom-sar-1x"
    ],
    "fixed_mdas": {
      "2": "m4-1g-rj+6-10g-sfp++2-25g-sfp28",
      "3": "isa-ms-v",
      "4": "isa-ms-v"
    },
    "integrated": true,
    "mda": [
      "m2-1g-sfp+2-10g-sfp+"
    ],
    "supports_port_speed_mode": [
      "c5-c12-1g/10g",
      "c5-c10-10g+c11-c12-10g/25g"
    ],
    "supports_system_profile": true
  },
  "SAR-Mx": {
    "cpm": [
      "iom-sar-1x"
    ],
    "fixed_mdas": {
      "2": "m4-1g-rj+6-10g-sfp++2-25g-sfp28",
      "3": "isa-ms-v",
      "4": "isa-ms-v"
    },
    "integrated": true,
    "mda": [
      "m2-1g-sfp+2-10g-sfp+"
    ],
    "supports_port_speed_mode": [
      "c5-c12-1g/10g",
      "c5-c10-10g+c11-c12-10g/25g"
    ],
    "supports_system_profile": true
  },
  "SR-1": {
    "cpm": [
      "cpm-1"
    ],
    "integrated": true,
    "mda": [
      "me6-100gb-qsfp28",
      "me12-100gb-qsfp28"
    ],
    "supports_system_profile": true
  },
  "SR-1-24D": {
    "fixed_hw_cfg": "cpm-1x/i24-800g-qsfpdd-1",
    "iom_slots": 1
  },
  "SR-1-46S": {
    "fixed_hw_cfg": "cpm-1x/i40-200g-sfpdd+6-800g-qsfpdd-1",
    "iom_slots": 1
  },
  "SR-1-48D": {
    "fixed_hw_cfg": "cpm-1x/i48-400g-qsfpdd-1",
    "iom_slots": 1
  },
  "SR-1-92S": {
    "fixed_hw_cfg": "cpm-1x/i80-200g-sfpdd+12-400g-qsfpdd-1",
    "iom_slots": 1
  },
  "SR-12": {
    "cpm": [
      "cpm5"
    ],
    "iom": [
      "iom5-e",
      "imm-2pac-fp3",
      "imm48-1gb-sfp-c",
      "iom4-e",
      "iom4-e-b",
      "iom4-e-hs"
    ],
    "iom_slots": 10,
    "mda": [
      "me6-100gb-qsfp28"
    ],
    "redundant": true,
    "sfm": [
      "m-sfm6-7/12",
      "m-sfm5-12"
    ],
    "supports_system_profile": true
  },
  "SR-12e": {
    "cpm": [
      "cpm5"
    ],
    "iom": [
      "iom5-e",
      "imm-2pac-fp3",
      "imm40-10gb-sfp",
      "imm4-100gb-cfp4",
      "imm4-100gb-cxp",
      "iom4-e",
      "iom4-e-b",
      "iom4-e-hs"
    ],
    "iom_slots": 9,
    "mda": [
      "me6-100gb-qsfp28"
    ],
    "redundant": true,
    "sfm": [
      "m-sfm6-12e",
      "m-sfm5-12e"
    ],
    "supports_system_profile": true
  },
  "SR-14s": {
    "cpm": [
      "cpm2-s",
      "cpm-s"
    ],
    "iom": [
      "xcm2-14s",
      "xcm-14s",
      "xcm-14s-b"
    ],
    "iom_slots": 6,
    "mda": [
      "x2-s36-800g-qsfpdd-18.0t"
    ],
    "redundant": true,
    "sfm": [
      "sfm2-s",
      "sfm-s"
    ],
    "supports_system_profile": true,
    "xiom": [
      "iom-s-3.0t",
      "iom-s-1.5t",
      "iom2-se-6.0t",
      "iom2-se-3.0t"
    ]
  },
  "SR-1e": {
    "cpm": [
      "cpm-e"
    ],
    "iom": [
      "iom-e"
    ],
    "iom_slots": 1,
    "mda": [
      "me1-100gb-cfp2",
      "me10-10gb-sfp+",
      "me6-10gb-sfp+",
      "isa2-aa"
    ],
    "redundant": true
  },
  "SR-1s": {
    "cpm": [
      "cpm-1s"
    ],
    "integrated": true,
    "mda": [
      "s36-100gb-qsfp28"
    ],
    "supports_system_profile": true,
    "xiom": [
      "iom-s-3.0t"
    ]
  },
  "SR-1se": {
    "fixed_hw_cfg": "cpm-1se/imm36-800g-qsfpdd",
    "iom_slots": 1
  },
  "SR-1x-48D": {
    "fixed_hw_cfg": "cpm-1x/i48-800g-qsfpdd-1x",
    "iom_slots": 1
  },
  "SR-1x-92S": {
    "fixed_hw_cfg": "cpm-1x/i80-200g-sfpdd+12-800g-qsfpdd-1x",
    "iom_slots": 1
  },
  "SR-2e": {
    "cpm": [
      "cpm-e"
    ],
    "iom": [
      "iom-e"
    ],
    "iom_slots": 2,
    "mda": [
      "me10-10gb-sfp+"
    ],
    "redundant": true
  },
  "SR-2s": {
    "cpm": [
      "cpm-2s"
    ],
    "iom": [
      "xcm-2s"
    ],
    "iom_slots": 2,
    "mda": [
      "s36-100gb-qsfp28"
    ],
    "redundant": true,
    "sfm": [
      "sfm-2s"
    ],
    "supports_system_profile": true,
    "xiom": [
      "iom-s-3.0t"
    ]
  },
  "SR-2se": {
    "cpm": [
      "cpm-2se"
    ],
    "iom": [
      "xcm-2se",
      "xcmc-2se"
    ],
    "iom_slots": 2,
    "mda": [
      "x2-s36-800g-qsfpdd-18.0t"
    ],
    "redundant": true,
    "sfm": [
      "sfm-2se"
    ],
    "xiom": [
      "iom2-s-6.0t",
      "iom2-s-3.0t"
    ]
  },
  "SR-3e": {
    "cpm": [
      "cpm-e"
    ],
    "iom": [
      "iom-e"
    ],
    "iom_slots": 3,
    "mda": [
      "me1-100gb-cfp2"
    ],
    "redundant": true
  },
  "SR-7": {
    "cpm": [
      "cpm5"
    ],
    "iom": [
      "iom5-e",
      "imm-2pac-fp3",
      "imm48-1gb-sfp-c",
      "iom4-e",
      "iom4-e-b",
      "iom4-e-hs"
    ],
    "iom_slots": 5,
    "mda": [
      "me6-100gb-qsfp28"
    ],
    "redundant": true,
    "sfm": [
      "m-sfm6-7/12",
      "m-sfm5-7",
      "m-sfm5-12"
    ],
    "supports_system_profile": true
  },
  "SR-7s": {
    "cpm": [
      "cpm2-s",
      "cpm-s"
    ],
    "iom": [
      "xcm2-7s",
      "xcm-7s",
      "xcm-7s-b"
    ],
    "iom_slots": 6,
    "mda": [
      "x2-s36-800g-qsfpdd-18.0t"
    ],
    "redundant": true,
    "sfm": [
      "sfm2-s",
      "sfm-s"
    ],
    "supports_system_profile": true,
    "xiom": [
      "iom-s-3.0t",
      "iom-s-1.5t",
      "iom2-se-6.0t",
      "iom2-se-3.0t"
    ]
  },
  "SR-a4": {
    "cpm": [
      "cpm-a"
    ],
    "iom": [
      "iom-a"
    ],
    "iom_slots": 1,
    "mda": [
      "maxp1-100gb-cfp",
      "ma44-1gb-csfp",
      "maxp10-10gb-sfp+",
      "ma2-10gb-sfp+12-1gb-sfp"
    ],
    "redundant": true
  },
  "SR-a8": {
    "cpm": [
      "cpm-a"
    ],
    "iom": [
      "iom-a"
    ],
    "iom_slots": 2,
    "mda": [
      "maxp1-100gb-cfp"
    ],
    "redundant": true
  },
  "VSR-I": {
    "cpm": [
      "cpm-v/iom-v"
    ],
    "integrated": true,
    "mda": [
      "m20-v"
    ]
  },
  "XRS-20": {
    "cpm": [
      "cpm2-x20",
      "cpm-x20"
    ],
    "iom": [
      "xcm2-x20",
      "xcm-x20"
    ],
    "iom_slots": 20,
    "mda": [
      "x24-100g-qsfp28"
    ],
    "redundant": true,
    "sfm": [
      "sfm2-x20s",
      "sfm-x20s-b",
      "sfm-x20-b",
      "sfm-x20"
    ],
    "supports_extension": true,
    "supports_system_profile": true
  },
  "XRS-20e": {
    "alias": "XRS-20"
  }
};
