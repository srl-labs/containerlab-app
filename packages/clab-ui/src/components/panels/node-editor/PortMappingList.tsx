// Port mappings of a node: one spec per row with its protocol, including the Tailscale proxy.
import React, { useRef } from "react";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import { DeleteItemButton } from "../../ui/form/ListButtons";
import { createRowIds } from "../../ui/form/listRowIds";
import {
  joinPortMapping,
  portProtocol,
  splitPortMapping,
  type PortProtocol
} from "../../../core/utilities/portMappings";

const PROTOCOL_LABELS: Record<PortProtocol, string> = {
  tcp: "TCP",
  udp: "UDP",
  sctp: "SCTP",
  ts: "Tailscale"
};

interface PortMappingListProps {
  items: string[];
  onChange: (items: string[]) => void;
}

export const PortMappingList: React.FC<PortMappingListProps> = ({ items, onChange }) => {
  // Stable row identities, as in DynamicList: removing a row keeps its neighbours' focus.
  const rowIdsRef = useRef<number[] | null>(null);
  if (rowIdsRef.current === null || rowIdsRef.current.length !== items.length) {
    rowIdsRef.current = createRowIds(items.length);
  }
  const rowIds = rowIdsRef.current;

  const setItem = (index: number, value: string) =>
    onChange(items.map((item, i) => (i === index ? value : item)));
  const removeItem = (index: number) => {
    rowIdsRef.current = rowIds.filter((_, i) => i !== index);
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {items.map((item, index) => {
        const mapping = splitPortMapping(item);
        const protocol = portProtocol(mapping);
        return (
          <Box
            key={rowIds[index]}
            data-testid="node-port-mapping"
            sx={{ display: "flex", gap: 1, alignItems: "center" }}
          >
            <TextField
              value={mapping.spec}
              onChange={(event) =>
                setItem(index, joinPortMapping({ ...mapping, spec: event.target.value }, protocol))
              }
              placeholder="host:container"
              size="small"
              fullWidth
              slotProps={{ htmlInput: { "aria-label": "Port mapping" } }}
            />
            <TextField
              select
              value={protocol}
              onChange={(event) =>
                setItem(index, joinPortMapping(mapping, event.target.value as PortProtocol))
              }
              size="small"
              sx={{ width: 128, flexShrink: 0 }}
              slotProps={{ select: { inputProps: { "aria-label": "Protocol" } } }}
            >
              {Object.entries(PROTOCOL_LABELS).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <DeleteItemButton onRemove={() => removeItem(index)} />
          </Box>
        );
      })}
    </Box>
  );
};
