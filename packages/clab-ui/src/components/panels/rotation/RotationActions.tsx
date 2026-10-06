import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import ContentPasteGoIcon from "@mui/icons-material/ContentPasteGoOutlined";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import CheckIcon from "@mui/icons-material/Check";
import { formatRotation } from "../../../annotations/rotation";
import { useRotationStore } from "../../../stores/rotationStore";

const ICON_SX = { fontSize: 16 } as const;

export function RotationActions({
  angle,
  editable,
  onChange
}: {
  angle: number | null;
  editable: boolean;
  onChange?: (angle: number) => void;
}) {
  const copiedAngle = useRotationStore((state) => state.copiedAngle);
  const [copied, setCopied] = useState(false);
  const apply = (value: number) => onChange?.(value);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <>
      <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, gap: 0.25 }}>
        <Tooltip title={copied ? "Rotation copied" : "Copy rotation"}>
          <span>
            <IconButton
              size="small"
              aria-label="Copy rotation"
              disabled={angle === null}
              onClick={() => {
                useRotationStore.getState().copyAngle(angle ?? 0);
                if ("clipboard" in navigator)
                  void navigator.clipboard.writeText(formatRotation(angle ?? 0)).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? <CheckIcon sx={ICON_SX} /> : <ContentCopyIcon sx={ICON_SX} />}
            </IconButton>
          </span>
        </Tooltip>
        {onChange && (
          <>
            <Tooltip
              title={
                copiedAngle === null
                  ? "Copy an object's rotation first"
                  : `Apply copied rotation (${formatRotation(copiedAngle)}°)`
              }
            >
              <span>
                <IconButton
                  size="small"
                  aria-label="Apply copied rotation"
                  disabled={!editable || copiedAngle === null}
                  onClick={() => {
                    if (copiedAngle !== null) {
                      apply(copiedAngle);
                    }
                  }}
                >
                  <ContentPasteGoIcon sx={ICON_SX} />
                </IconButton>
              </span>
            </Tooltip>
            <Box sx={{ width: 4 }} />
            <Tooltip title="Rotate 90° clockwise">
              <span>
                <IconButton
                  size="small"
                  aria-label="Rotate 90° clockwise"
                  disabled={!editable}
                  onClick={() => apply((angle ?? 0) + 90)}
                >
                  <RotateRightIcon sx={ICON_SX} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Reset rotation">
              <span>
                <IconButton
                  size="small"
                  aria-label="Reset rotation"
                  disabled={!editable}
                  onClick={() => apply(0)}
                >
                  <RestartAltIcon sx={ICON_SX} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        )}
      </Box>
      <Box
        role="status"
        sx={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clipPath: "inset(50%)"
        }}
      >
        {copied ? "Rotation copied" : ""}
      </Box>
    </>
  );
}
