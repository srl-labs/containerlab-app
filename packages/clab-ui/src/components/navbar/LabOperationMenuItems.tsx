// Lab operation entries of the navbar's deploy menu.
import React from "react";
import Divider from "@mui/material/Divider";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import ManageSearchRoundedIcon from "@mui/icons-material/ManageSearchRounded";
import PhotoCameraOutlinedIcon from "@mui/icons-material/PhotoCameraOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import TerminalRoundedIcon from "@mui/icons-material/TerminalRounded";

import type { LabOperationSupport } from "../../host/labOperations";
import type { LabOperationDialogKind } from "../../stores/labOperationsStore";

interface LabOperationEntry {
  kind: LabOperationDialogKind;
  label: string;
  icon: React.ReactNode;
  available: (support: LabOperationSupport) => boolean;
}

const ENTRIES: readonly LabOperationEntry[] = [
  {
    kind: "exec",
    label: "Run Command…",
    icon: <TerminalRoundedIcon />,
    available: () => true
  },
  {
    kind: "saveConfigs",
    label: "Save Configs…",
    icon: <SaveOutlinedIcon />,
    available: () => true
  },
  {
    kind: "snapshots",
    label: "Save VM Snapshots…",
    icon: <PhotoCameraOutlinedIcon />,
    available: (support) => support.snapshotSave
  },
  {
    kind: "details",
    label: "Inspect Details",
    icon: <ManageSearchRoundedIcon />,
    available: (support) => support.inspectDetails
  }
];

/** Menu children (not a fragment, which MUI menus do not take). */
export function labOperationMenuItems(options: {
  support: LabOperationSupport;
  disabled: boolean;
  onOpen: (kind: LabOperationDialogKind) => void;
  /** Entries the lab host lacks, with why: shown greyed out instead of hidden (c9s). */
  unavailable?: Partial<Record<LabOperationDialogKind, string>>;
}): React.ReactNode[] {
  const items = ENTRIES.flatMap((entry) => {
    const reason = entry.available(options.support) ? undefined : options.unavailable?.[entry.kind];
    if (!entry.available(options.support) && reason === undefined) return [];
    return [
      <MenuItem
        key={entry.kind}
        onClick={() => options.onOpen(entry.kind)}
        disabled={options.disabled || reason !== undefined}
        data-testid={`navbar-deploy-item-lab-${entry.kind}`}
      >
        <ListItemIcon>{entry.icon}</ListItemIcon>
        <ListItemText
          {...(reason !== undefined ? { secondary: reason } : {})}
          slotProps={{ secondary: { sx: { fontSize: 11, maxWidth: 240, whiteSpace: "normal" } } }}
        >
          {entry.label}
        </ListItemText>
      </MenuItem>
    ];
  });
  return [<Divider key="lab-operations-divider" />, ...items];
}
