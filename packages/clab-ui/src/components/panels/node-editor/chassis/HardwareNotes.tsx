// What the tab says about a node's hardware: whether it fits, how to start, where the list is from.
import React from "react";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHighOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircleOutlineRounded";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

import {
  allChassisSlots,
  hardwareTargetKey,
  imageTag,
  issueSlotId,
  SFM_SLOT_ID,
  type ChassisLayout,
  type HardwareIssue,
  type SrsimChassis
} from "../../../../core/sros/srsimChassis";
import { SRSIM_CHASSIS_INFO_RELEASE } from "../../../../core/sros/srsimChassisInfo";

const NOTE_SX = {
  display: "flex",
  alignItems: "flex-start",
  gap: 0.5,
  color: "text.secondary",
  lineHeight: 1.4
} as const;

/** Issues listed by name; the rest are marked on their slots */
const LISTED_ISSUES = 3;

/** Where an issue sits, in the words of the chassis */
function issuePlace(slotId: string | undefined, layout: ChassisLayout): string {
  if (slotId === SFM_SLOT_ID) return "SFM";
  const label = allChassisSlots(layout).find((slot) => slot.id === slotId)?.label;
  return label === undefined ? "Chassis" : `Slot ${label}`;
}

/** Whether the node's hardware fits, with what to do about it when it does not */
export const HardwareStatus: React.FC<{
  chassis: SrsimChassis | undefined;
  isEmpty: boolean;
  issues: HardwareIssue[];
  layout: ChassisLayout;
  onSelect: (id: string) => void;
  onFit: () => void;
}> = ({ chassis, isEmpty, issues, layout, onSelect, onFit }) => {
  if (issues.length === 0) {
    if (!chassis || isEmpty) return null;
    return (
      <Typography variant="caption" component="div" data-testid="chassis-status" data-status="ok" sx={NOTE_SX}>
        <CheckCircleIcon sx={{ fontSize: 14, mt: "1px", color: "success.main" }} aria-hidden />
        <span>Fits {chassis.name}</span>
      </Typography>
    );
  }
  const unlisted = issues.length - LISTED_ISSUES;
  return (
    <Alert
      severity="warning"
      data-testid="chassis-status"
      data-status="issues"
      action={
        chassis && (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<AutoFixHighIcon />}
            onClick={onFit}
            data-testid="chassis-fit"
            title="Removes what this chassis has no slot for and swaps unlisted types for the first listed one"
            sx={{ whiteSpace: "nowrap" }}
          >
            Fit to {chassis.name}
          </Button>
        )
      }
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {issues.slice(0, LISTED_ISSUES).map(({ target, message }) => {
          const slotId = issueSlotId(target, layout);
          return (
            <ButtonBase
              key={`${hardwareTargetKey(target)}:${message}`}
              onClick={() => {
                if (slotId !== undefined) onSelect(slotId);
              }}
              sx={{
                display: "block",
                fontSize: "inherit",
                fontFamily: "inherit",
                lineHeight: 1.4,
                textAlign: "left",
                "&:hover": { textDecoration: "underline" }
              }}
            >
              {issuePlace(slotId, layout)}: {message}
            </ButtonBase>
          );
        })}
        {unlisted > 0 && (
          <Box component="span" sx={{ opacity: 0.8, lineHeight: 1.4 }}>
            and {unlisted} more, marked below
          </Box>
        )}
      </Box>
    </Alert>
  );
};

/** The way in for a chassis with nothing on it yet */
export const StarterPrompt: React.FC<{ chassisName: string | undefined; onStart: () => void }> = ({
  chassisName,
  onStart
}) => (
  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}>
    <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
      Nothing installed yet. {chassisName} runs as a chassis once it has a CPM and a card.
    </Typography>
    <Button
      size="small"
      variant="outlined"
      startIcon={<AutoFixHighIcon />}
      onClick={onStart}
      data-testid="chassis-starter"
      title="CPM A, one line card with its MDA, and the fabric"
      sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
    >
      Add starter hardware
    </Button>
  </Box>
);

function catalogNote(
  nodeType: string,
  chassis: SrsimChassis | undefined,
  image: string | undefined
): string {
  if (!chassis) {
    const name = nodeType === "" ? "This type" : nodeType;
    return `${name} is not in the hardware list, so every SR OS type is offered. Containerlab checks them against the image at deploy.`;
  }
  const tag = imageTag(image);
  return tag === undefined || tag === SRSIM_CHASSIS_INFO_RELEASE
    ? `Hardware list from SR-SIM ${SRSIM_CHASSIS_INFO_RELEASE}. Containerlab checks it against the node's image at deploy.`
    : `Hardware list from SR-SIM ${SRSIM_CHASSIS_INFO_RELEASE}; this node runs ${tag}, which may differ. Containerlab checks it against the image at deploy.`;
}

/** Where the hardware list comes from and how far to trust it (SR-SIM nodes only) */
export const CatalogNotes: React.FC<{
  nodeType: string;
  chassis: SrsimChassis | undefined;
  image: string | undefined;
  generatesConfig: boolean;
  envOverrides: string[];
}> = ({ nodeType, chassis, image, generatesConfig, envOverrides }) => {
  const notes = [catalogNote(nodeType, chassis, image)];
  if (envOverrides.length > 0) {
    notes.push(`Set in env, which wins over this tab: ${envOverrides.join(", ")}.`);
  }
  if (!generatesConfig) {
    notes.push("Component config generation is off on the Kind tab, so this hardware needs its own config.");
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, px: 2, pt: 2, pb: 1 }} data-testid="chassis-notes">
      {notes.map((note) => (
        <Typography key={note} variant="caption" component="div" sx={NOTE_SX}>
          <InfoOutlinedIcon sx={{ fontSize: 14, mt: "1px", flexShrink: 0 }} aria-hidden />
          <span>{note}</span>
        </Typography>
      ))}
    </Box>
  );
};
