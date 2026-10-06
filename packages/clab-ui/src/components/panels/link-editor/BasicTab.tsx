// Basic link configuration tab.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Slider from "@mui/material/Slider";
import Button from "@mui/material/Button";

import { InputField, PanelSection } from "../../ui/form";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import {
  DEFAULT_ENDPOINT_LABEL_OFFSET,
  ENDPOINT_LABEL_OFFSET_MIN,
  ENDPOINT_LABEL_OFFSET_MAX
} from "../../../annotations/endpointLabelOffset";

import type { LinkTabProps } from "./types";
import { LinkRotationControl } from "../rotation/LinkRotationControl";

interface EndpointInterfaceFieldProps {
  isNetwork: boolean;
  nodeName: string;
  inputId: string;
  endpoint: string | undefined;
  onChange: (value: string) => void;
}

const READ_ONLY_ENDPOINT_SX = {
  position: "relative",
  display: "flex",
  alignItems: "center",
  height: 32,
  px: 1.5,
  border: 1,
  borderStyle: "dashed",
  borderColor: "divider",
  borderRadius: controlRadius,
  color: "text.secondary"
} as const;

const READ_ONLY_ENDPOINT_LABEL_SX = {
  position: "absolute",
  top: -8,
  left: 9,
  px: 0.5,
  fontSize: 11,
  lineHeight: "14px",
  color: "text.secondary",
  bgcolor: "background.paper",
  maxWidth: "calc(100% - 18px)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
} as const;

const EndpointInterfaceField: React.FC<EndpointInterfaceFieldProps> = ({
  isNetwork,
  nodeName,
  inputId,
  endpoint,
  onChange
}) => {
  if (isNetwork) {
    // Network endpoints have no editable interface: show the name in a read-only box that
    // shares the notched field geometry so both endpoint columns line up.
    return (
      <Box sx={READ_ONLY_ENDPOINT_SX}>
        <Typography component="span" sx={READ_ONLY_ENDPOINT_LABEL_SX}>
          {nodeName} Interface
        </Typography>
        <Typography component="span" noWrap sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12 }}>
          {nodeName || "Unknown"}
        </Typography>
      </Box>
    );
  }

  return (
    <InputField
      id={inputId}
      label={`${nodeName} Interface`}
      required
      value={endpoint ?? ""}
      onChange={onChange}
      placeholder="e.g., eth1, e1-1"
    />
  );
};

const OFFSET_BOUND_SX = { color: "text.secondary", fontVariantNumeric: "tabular-nums" } as const;

interface LabelOffsetSectionProps {
  endpointOffsetValue: number;
  onOffsetChange: (_event: Event, value: number | number[]) => void;
  onOffsetReset: () => void;
}

const LabelOffsetSection: React.FC<LabelOffsetSectionProps> = ({
  endpointOffsetValue,
  onOffsetChange,
  onOffsetReset
}) => {
  return (
    <PanelSection title="Label Offset" bodySx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      <>
        <Typography variant="caption" sx={OFFSET_BOUND_SX}>
          {ENDPOINT_LABEL_OFFSET_MIN}
        </Typography>
        <Slider
          id="link-endpoint-offset"
          value={endpointOffsetValue}
          min={ENDPOINT_LABEL_OFFSET_MIN}
          max={ENDPOINT_LABEL_OFFSET_MAX}
          step={1}
          onChange={onOffsetChange}
          valueLabelDisplay="auto"
          sx={{ flex: 1 }}
        />
        <Typography variant="caption" sx={OFFSET_BOUND_SX}>
          {ENDPOINT_LABEL_OFFSET_MAX}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={onOffsetReset}
          title={`Reset to ${DEFAULT_ENDPOINT_LABEL_OFFSET}`}
        >
          Reset
        </Button>
      </>
    </PanelSection>
  );
};

function resolveEndpointOffsetValue(offset: unknown): number {
  if (typeof offset === "number" && Number.isFinite(offset)) {
    return offset;
  }

  return DEFAULT_ENDPOINT_LABEL_OFFSET;
}

export const BasicTab: React.FC<LinkTabProps> = ({ data, onChange, onPreviewOffset }) => {
  const sourceName = data.source.length > 0 ? data.source : "Source";
  const targetName = data.target.length > 0 ? data.target : "Target";
  const endpointOffsetValue = resolveEndpointOffsetValue(data.endpointLabelOffset);

  const handleOffsetChange = (_event: Event, value: number | number[]) => {
    const nextOffset = typeof value === "number" ? value : value[0];
    const nextData = {
      ...data,
      endpointLabelOffset: nextOffset,
      endpointLabelOffsetEnabled: true
    };
    onChange({
      endpointLabelOffset: nextOffset,
      endpointLabelOffsetEnabled: true
    });
    onPreviewOffset?.(nextData);
  };

  const handleOffsetReset = () => {
    const nextData = {
      ...data,
      endpointLabelOffset: DEFAULT_ENDPOINT_LABEL_OFFSET,
      endpointLabelOffsetEnabled: true
    };
    onChange({
      endpointLabelOffset: DEFAULT_ENDPOINT_LABEL_OFFSET,
      endpointLabelOffsetEnabled: true
    });
    onPreviewOffset?.(nextData);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <PanelSection title="Endpoints">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <EndpointInterfaceField
            isNetwork={Boolean(data.sourceIsNetwork)}
            nodeName={sourceName}
            inputId="link-source-interface"
            endpoint={data.sourceEndpoint}
            onChange={(value) => onChange({ sourceEndpoint: value })}
          />
          <EndpointInterfaceField
            isNetwork={Boolean(data.targetIsNetwork)}
            nodeName={targetName}
            inputId="link-target-interface"
            endpoint={data.targetEndpoint}
            onChange={(value) => onChange({ targetEndpoint: value })}
          />
        </Box>
      </PanelSection>

      <LinkRotationControl edgeId={data.id} />
      <LabelOffsetSection
        endpointOffsetValue={endpointOffsetValue}
        onOffsetChange={handleOffsetChange}
        onOffsetReset={handleOffsetReset}
      />
    </Box>
  );
};
