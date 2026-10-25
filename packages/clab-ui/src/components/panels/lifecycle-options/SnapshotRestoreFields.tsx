// Deploy option: boot VM nodes from saved snapshots (`--restore-all`, `--restore`).
import React from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";

import type { LabSnapshotRestore } from "../../../host/lifecycleOptions";
import { InputField } from "../../ui/form/InputField";

export interface SnapshotRestoreFieldsProps {
  nodeNames: string[];
  restoreAll: string;
  restore: LabSnapshotRestore[];
  error?: string;
  onRestoreAllChange: (value: string) => void;
  onRestoreChange: (value: LabSnapshotRestore[]) => void;
}

export const SnapshotRestoreFields: React.FC<SnapshotRestoreFieldsProps> = ({
  nodeNames,
  restoreAll,
  restore,
  error,
  onRestoreAllChange,
  onRestoreChange
}) => {
  const updateRow = (index: number, patch: Partial<LabSnapshotRestore>) =>
    onRestoreChange(restore.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", gap: 1.5, pl: 3.5 }}
      data-testid="lifecycle-options-restore-fields"
    >
      <InputField
        id="lifecycle-options-restore-all"
        label="Snapshot directory"
        value={restoreAll}
        onChange={onRestoreAllChange}
        placeholder="snapshots"
        error={error !== undefined}
        helperText={
          error ??
          "Nodes with a <node>.tar here start from it; relative to the topology file. Empty uses only the files below."
        }
      />
      {restore.map((row, index) => (
        <Box
          // Rows have no identity beyond their position.
          key={index}
          sx={{ display: "grid", gridTemplateColumns: "1fr 2fr auto", gap: 1, alignItems: "start" }}
          data-testid={`lifecycle-options-restore-row-${index}`}
        >
          <Autocomplete
            size="small"
            options={nodeNames}
            value={row.node || null}
            onChange={(_event, value) => updateRow(index, { node: value ?? "" })}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Node"
                slotProps={{
                  ...params.slotProps,
                  htmlInput: {
                    ...params.slotProps.htmlInput,
                    "data-testid": `lifecycle-options-restore-node-${index}`
                  }
                }}
              />
            )}
          />
          <TextField
            size="small"
            label="Snapshot file"
            value={row.path}
            onChange={(event) => updateRow(index, { path: event.target.value })}
            placeholder="snapshots/node.tar"
            slotProps={{ htmlInput: { "data-testid": `lifecycle-options-restore-path-${index}` } }}
          />
          <IconButton
            size="small"
            aria-label="Remove node snapshot"
            onClick={() => onRestoreChange(restore.filter((_row, rowIndex) => rowIndex !== index))}
            sx={{ mt: 0.5 }}
          >
            <DeleteOutlinedIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      <Button
        size="small"
        variant="text"
        startIcon={<AddIcon />}
        sx={{ alignSelf: "flex-start" }}
        onClick={() => onRestoreChange([...restore, { node: "", path: "" }])}
        data-testid="lifecycle-options-restore-add"
      >
        Node snapshot file
      </Button>
    </Box>
  );
};
