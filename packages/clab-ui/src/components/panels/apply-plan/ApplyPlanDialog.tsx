// Show what `containerlab apply` would change in the running lab before applying.
import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Typography from "@mui/material/Typography";

import { applyPlanHasChanges, type ApplyPlan } from "../../../host/applyPlan";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";

import {
  applyPlanChangeCount,
  applyPlanLosesState,
  buildApplyPlanSections,
  type ApplyPlanSection
} from "./applyPlanSections";

export interface ApplyPlanDialogProps {
  open: boolean;
  /** The dry run, started by whoever opened the dialog. */
  planRequest: Promise<ApplyPlan>;
  onClose: () => void;
  onApply: () => void;
}

type PlanState =
  | { status: "loading" }
  | { status: "ready"; plan: ApplyPlan }
  | { status: "error"; message: string };

const TONE_COLOR: Record<ApplyPlanSection["tone"], string> = {
  success: "success.main",
  info: "info.main",
  warning: "warning.main",
  error: "error.main"
};

function useApplyPlan(planRequest: Promise<ApplyPlan>): PlanState {
  const [state, setState] = React.useState<PlanState>({ status: "loading" });
  React.useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    planRequest.then(
      (plan) => {
        if (!cancelled) setState({ status: "ready", plan });
      },
      (error: unknown) => {
        if (cancelled) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [planRequest]);
  return state;
}

const PlanSection: React.FC<{ section: ApplyPlanSection }> = ({ section }) => (
  <Box component="section" data-testid={`apply-plan-section-${section.id}`}>
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.75 }}>
      <Box
        aria-hidden
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: TONE_COLOR[section.tone],
          flexShrink: 0,
          alignSelf: "center"
        }}
      />
      <Typography variant="subtitle2" component="h3">
        {section.title}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {section.items.length}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto", textAlign: "right" }}>
        {section.description}
      </Typography>
    </Box>
    <Box
      component="ul"
      sx={{
        listStyle: "none",
        m: 0,
        p: 0,
        border: 1,
        borderColor: "divider",
        borderRadius: controlRadius,
        overflow: "hidden"
      }}
    >
      {section.items.map((item) => (
        <Box
          component="li"
          key={item.label}
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 1.5,
            px: 1.5,
            py: 0.75,
            borderLeft: 3,
            borderLeftColor: TONE_COLOR[section.tone],
            "&:not(:last-of-type)": { borderBottom: 1, borderBottomColor: "divider" }
          }}
        >
          <Typography
            variant="body2"
            sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12.5, overflowWrap: "anywhere" }}
          >
            {item.label}
          </Typography>
          {item.reason !== undefined && (
            <Typography
              variant="caption"
              sx={{ color: "text.secondary", ml: "auto", textAlign: "right" }}
            >
              {item.reason}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  </Box>
);

const PlanBody: React.FC<{ state: PlanState }> = ({ state }) => {
  if (state.status === "loading") {
    return (
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 3, justifyContent: "center" }}
        data-testid="apply-plan-loading"
      >
        <CircularProgress size={18} />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Comparing the topology with the running lab…
        </Typography>
      </Box>
    );
  }
  if (state.status === "error") {
    return (
      <Alert severity="error" variant="outlined" data-testid="apply-plan-error">
        Could not work out the changes: {state.message}
      </Alert>
    );
  }

  const { plan } = state;
  if (plan.deploysLab) {
    return (
      <Alert severity="info" variant="outlined" data-testid="apply-plan-deploy">
        The lab is not running. Apply deploys the whole topology.
      </Alert>
    );
  }
  if (!applyPlanHasChanges(plan)) {
    return (
      <Alert severity="success" variant="outlined" data-testid="apply-plan-in-sync">
        Nothing to apply. The running lab already matches the topology.
      </Alert>
    );
  }

  const count = applyPlanChangeCount(plan);
  return (
    <>
      <Typography variant="body2" sx={{ color: "text.secondary" }} data-testid="apply-plan-summary">
        Applying makes {count} {count === 1 ? "change" : "changes"} to the running lab.
      </Typography>
      {buildApplyPlanSections(plan).map((section) => (
        <PlanSection key={section.id} section={section} />
      ))}
      {applyPlanLosesState(plan) && (
        <Alert severity="warning" variant="outlined" data-testid="apply-plan-state-warning">
          Recreated and removed nodes lose unsaved configuration. Save the lab first to keep it.
        </Alert>
      )}
    </>
  );
};

export const ApplyPlanDialog: React.FC<ApplyPlanDialogProps> = ({
  open,
  planRequest,
  onClose,
  onApply
}) => {
  const state = useApplyPlan(planRequest);
  const inSync = state.status === "ready" && !applyPlanHasChanges(state.plan);
  const applyLabel = state.status === "error" ? "Apply anyway" : "Apply";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth data-testid="apply-plan-dialog">
      <DialogTitleWithClose
        title="Apply changes"
        onClose={onClose}
        closeButtonTestId="apply-plan-close"
      />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <PlanBody state={state} />
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={onClose} data-testid="apply-plan-cancel">
          {inSync ? "Close" : "Cancel"}
        </Button>
        {!inSync && (
          <Button
            size="small"
            onClick={onApply}
            disabled={state.status === "loading"}
            data-testid="apply-plan-apply"
          >
            {applyLabel}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};
