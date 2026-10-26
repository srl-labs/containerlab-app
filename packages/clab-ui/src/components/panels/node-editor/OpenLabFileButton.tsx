// Opens a node's startup config, license or bind source in the host's editor.
import React from "react";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import type { LabFileReferenceKind, LabFileRequest } from "../../../host/labFiles";
import { useLabFileOpener, useLabFileResolver } from "../../../hooks/editor/useLabFiles";

/**
 * The file a value of the node opens, with the host's opener; undefined when
 * the host cannot open files or the value names none.
 */
export function useNodeLabFile(
  nodeName: string | undefined
): (value: string | undefined, kind: LabFileReferenceKind) => { request: LabFileRequest; open: (request: LabFileRequest) => void } | undefined {
  const open = useLabFileOpener();
  const resolve = useLabFileResolver();
  return (value, kind) => {
    if (!open || !resolve || nodeName === undefined || value === undefined || value === "") {
      return undefined;
    }
    const request = resolve(value, kind, nodeName);
    return request ? { request, open } : undefined;
  };
}

export const OpenLabFileButton: React.FC<{
  file: { request: LabFileRequest; open: (request: LabFileRequest) => void };
  testId?: string;
}> = ({ file, testId }) => {
  const label = `Open ${file.request.path}`;
  return (
    <Tooltip title={label}>
      <IconButton
        size="small"
        aria-label={label}
        data-testid={testId}
        onClick={() => file.open(file.request)}
        sx={{ flexShrink: 0 }}
      >
        <OpenInNewIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Tooltip>
  );
};
