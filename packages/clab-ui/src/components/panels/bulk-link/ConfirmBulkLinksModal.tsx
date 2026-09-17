// Confirmation dialog for bulk link creation.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";

import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";

interface ConfirmBulkLinksModalProps {
  isOpen: boolean;
  count: number;
  sourcePattern: string;
  targetPattern: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmBulkLinksModal: React.FC<ConfirmBulkLinksModalProps> = ({
  isOpen,
  count,
  sourcePattern,
  targetPattern,
  onCancel,
  onConfirm
}) => (
  <Dialog open={isOpen} onClose={onCancel} maxWidth="xs" fullWidth>
    <DialogTitleWithClose title="Bulk Link Creation" onClose={onCancel} />
    <DialogContent dividers>
      <Box
        sx={{
          p: 1,
          borderRadius: 0.5,
          border: 1
        }}
      >
        <Typography variant="body2">
          Create <strong>{count}</strong> new link{count === 1 ? "" : "s"}?
        </Typography>
        <Box sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Source: <code className="select-text">{sourcePattern}</code>
          </Typography>
          <br />
          <Typography variant="caption" color="text.secondary">
            Target: <code className="select-text">{targetPattern}</code>
          </Typography>
        </Box>
      </Box>
    </DialogContent>
    <DialogActions sx={{ px: 2, py: 1.5 }}>
      <Button size="small" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="small" onClick={onConfirm}>
        Create Links
      </Button>
    </DialogActions>
  </Dialog>
);
