// Rows and add controls of the Defaults & Groups section in Lab Settings.
import React, { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";

import { useSchema } from "../../../hooks/editor";
import type { ClabNode } from "../../../core/types/topology";
import { FilterableDropdown } from "../../ui/form";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** e.g. "image, env, exec +2 more" */
function describeKeys(config: ClabNode): string {
  const keys = Object.keys(config);
  if (keys.length === 0) return "Nothing set yet";
  const shown = keys.slice(0, 4).join(", ");
  return keys.length > 4 ? `${shown} +${keys.length - 4} more` : shown;
}

interface SectionRowProps {
  title: string;
  config: ClabNode;
  nodeCount?: number;
  isViewMode: boolean;
  testId: string;
  onEdit: () => void;
  onRemove?: () => void;
}

export const SectionRow: React.FC<SectionRowProps> = ({
  title,
  config,
  nodeCount,
  isViewMode,
  testId,
  onEdit,
  onRemove
}) => {
  const summary = describeKeys(config);
  const usage = nodeCount !== undefined ? ` · ${plural(nodeCount, "node")}` : "";
  return (
    <Box
      data-testid={testId}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        pl: 1.5,
        pr: 0.5,
        py: 0.75,
        "& + &": { borderTop: 1, borderColor: "divider" }
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
          {title}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }} noWrap>
          {summary}
          {usage}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", flexShrink: 0 }}>
        <Tooltip title={isViewMode ? "View" : "Edit"}>
          <IconButton size="small" aria-label={`${isViewMode ? "View" : "Edit"} ${title}`} onClick={onEdit}>
            {isViewMode ? (
              <VisibilityOutlinedIcon fontSize="small" />
            ) : (
              <EditOutlinedIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        {onRemove && !isViewMode ? (
          <Tooltip title="Remove">
            <IconButton size="small" aria-label={`Remove ${title}`} onClick={onRemove}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  );
};

export const SectionList: React.FC<{ children: React.ReactNode; testId: string }> = ({
  children,
  testId
}) => (
  <Box
    data-testid={testId}
    sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}
  >
    {children}
  </Box>
);

export const EmptyList: React.FC<{ text: string }> = ({ text }) => (
  <Typography variant="body2" sx={{ color: "text.secondary", px: 1.5, py: 1 }}>
    {text}
  </Typography>
);

interface AddSectionProps {
  level: "kind" | "group";
  existing: string[];
  onAdd: (name: string) => void;
}

/** Name field and Add button for a new kind (picked from the schema) or group. */
export const AddSection: React.FC<AddSectionProps> = ({ level, existing, onAdd }) => {
  const [name, setName] = useState("");
  const { kinds } = useSchema();
  const kindOptions = useMemo(
    () =>
      kinds
        .filter((kind) => !existing.some((entry) => entry.toLowerCase() === kind.toLowerCase()))
        .map((kind) => ({ value: kind, label: kind })),
    [kinds, existing]
  );
  const trimmed = name.trim();
  const isTaken = existing.includes(trimmed);
  const add = () => {
    if (trimmed === "" || isTaken) return;
    onAdd(trimmed);
    setName("");
  };

  return (
    <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {level === "kind" ? (
          <FilterableDropdown
            id="lab-inheritance-add-kind"
            label="Kind"
            options={kindOptions}
            value={name}
            onChange={setName}
            placeholder="Search or type kind..."
            allowFreeText={true}
            helperText={isTaken ? "This kind already has settings" : undefined}
          />
        ) : (
          <TextField
            id="lab-inheritance-add-group"
            label="Group name"
            size="small"
            fullWidth
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
            error={isTaken}
            helperText={isTaken ? "A group with this name exists" : undefined}
          />
        )}
      </Box>
      <Button
        size="small"
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={add}
        disabled={trimmed === "" || isTaken}
        data-testid={`lab-inheritance-add-${level}`}
        sx={{ mt: 0.25, flexShrink: 0 }}
      >
        Add {level}
      </Button>
    </Box>
  );
};
