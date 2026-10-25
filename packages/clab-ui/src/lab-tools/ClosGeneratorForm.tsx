/* eslint-disable import-x/max-dependencies */
// The Clos topology wizard, shared by the workspace dialog and the VS Code panel.
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React from "react";

import { controlRadius } from "../theme/surfaces";
import { MONO_FONT_FAMILY } from "../theme/typography";
import {
  CLOS_KIND_SUGGESTIONS,
  closDraftKinds,
  closDraftSummary,
  closDraftToRequest,
  closFileName,
  closGenerateCommand,
  validateClosDraft,
  withSuggestedImages,
  type ClosGeneratorDraft,
  type ClosGeneratorResult,
  type ClosTierDraft
} from "./closGenerator";

const MAX_TIERS = 6;

interface ClosEndpointOption {
  value: string;
  label: string;
  description?: string;
}

interface ClosGeneratorFormState {
  draft: ClosGeneratorDraft;
  endpointId: string;
  /** Errors show once the user tried to generate, so an empty form stays calm. */
  showErrors: boolean;
}

/** State and actions of the wizard, so each host can place the buttons itself. */
export function useClosGeneratorForm(initialDraft: ClosGeneratorDraft, defaultEndpointId = "") {
  const [state, setState] = React.useState<ClosGeneratorFormState>(() => ({
    draft: initialDraft,
    endpointId: defaultEndpointId,
    showErrors: false
  }));
  // The file follows the lab name until the user names the file.
  const fileFollowsName = React.useRef(initialDraft.fileName === closFileName(directoryOf(initialDraft.fileName), initialDraft.name));

  const update = React.useCallback((patch: Partial<ClosGeneratorDraft>) => {
    setState((current) => {
      let draft = { ...current.draft, ...patch };
      if (patch.fileName !== undefined) fileFollowsName.current = false;
      if (patch.name !== undefined && fileFollowsName.current) {
        draft.fileName = closFileName(directoryOf(current.draft.fileName), patch.name);
      }
      if (patch.tiers !== undefined) draft = withSuggestedImages(draft);
      return { ...current, draft };
    });
  }, []);

  const errors = validateClosDraft(state.draft);
  const valid = Object.keys(errors).length === 0;
  const request = closDraftToRequest(state.draft);

  return {
    draft: state.draft,
    endpointId: state.endpointId,
    errors: state.showErrors ? errors : {},
    valid,
    request,
    update,
    setEndpointId: (endpointId: string) => setState((current) => ({ ...current, endpointId })),
    /** The result to generate, or undefined after revealing what is missing. */
    submit(): ClosGeneratorResult | undefined {
      if (!valid) {
        setState((current) => ({ ...current, showErrors: true }));
        return undefined;
      }
      return {
        ...(state.endpointId ? { endpointId: state.endpointId } : {}),
        fileName: state.draft.fileName.trim(),
        request
      };
    }
  };
}

type ClosGeneratorFormModel = ReturnType<typeof useClosGeneratorForm>;

function directoryOf(fileName: string): string {
  const index = fileName.lastIndexOf("/");
  return index >= 0 ? fileName.slice(0, index) : "";
}

function SectionTitle({ step, title, hint }: { step: number; title: string; hint?: string }) {
  return (
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
      <Typography
        component="span"
        variant="caption"
        sx={{
          width: 20,
          height: 20,
          flex: "none",
          borderRadius: "50%",
          bgcolor: "action.selected",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 600
        }}
      >
        {step}
      </Typography>
      <Typography variant="subtitle2">{title}</Typography>
      {hint ? (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {hint}
        </Typography>
      ) : null}
    </Box>
  );
}

function TierRow(props: {
  index: number;
  tier: ClosTierDraft;
  error?: string;
  canRemove: boolean;
  onChange: (tier: ClosTierDraft) => void;
  onRemove: () => void;
}) {
  const { index, tier, error } = props;
  return (
    <Box data-testid={`clos-tier-${index}`} sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Box sx={{ display: "grid", gridTemplateColumns: "88px 1fr 1fr auto", gap: 1, alignItems: "center" }}>
        <TextField
          size="small"
          label={`Tier ${index + 1}`}
          value={tier.count}
          onChange={(event) => props.onChange({ ...tier, count: event.target.value })}
          error={Boolean(error)}
          slotProps={{
            htmlInput: { inputMode: "numeric", "aria-label": `Tier ${index + 1} nodes`, "data-testid": `clos-tier-${index}-count` }
          }}
        />
        <Autocomplete
          freeSolo
          size="small"
          options={CLOS_KIND_SUGGESTIONS}
          value={tier.kind}
          onInputChange={(_event, value) => props.onChange({ ...tier, kind: value })}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Kind"
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, "data-testid": `clos-tier-${index}-kind` }
              }}
            />
          )}
        />
        <TextField
          size="small"
          label="Type"
          placeholder="Kind default"
          value={tier.type}
          onChange={(event) => props.onChange({ ...tier, type: event.target.value })}
          slotProps={{ htmlInput: { "data-testid": `clos-tier-${index}-type` } }}
        />
        <Tooltip title="Remove tier">
          <span>
            <IconButton
              size="small"
              aria-label={`Remove tier ${index + 1}`}
              disabled={!props.canRemove}
              onClick={props.onRemove}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      {error ? (
        <Typography variant="caption" color="error" role="alert">
          {error}
        </Typography>
      ) : null}
    </Box>
  );
}

/** The wizard's fields: lab, tiers, images and containerlab's optional flags. */
export function ClosGeneratorFields(props: {
  form: ClosGeneratorFormModel;
  endpointOptions?: ClosEndpointOption[];
  error?: string;
}) {
  const { form, endpointOptions = [] } = props;
  const { draft, errors } = form;
  const kinds = closDraftKinds(draft);
  const summary = closDraftSummary(draft);
  const setTier = (index: number, tier: ClosTierDraft) =>
    form.update({ tiers: draft.tiers.map((current, position) => (position === index ? tier : current)) });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }} data-testid="clos-generator">
      {props.error ? (
        <Alert severity="error" data-testid="clos-generator-error">
          {props.error}
        </Alert>
      ) : null}

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <SectionTitle step={1} title="Lab" />
        {endpointOptions.length > 1 ? (
          <TextField
            select
            size="small"
            label="Lab host"
            value={form.endpointId}
            onChange={(event) => form.setEndpointId(event.target.value)}
            slotProps={{ htmlInput: { "data-testid": "clos-endpoint" } }}
          >
            {endpointOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1.4fr" }, gap: 1.5 }}>
          <TextField
            size="small"
            label="Lab name"
            value={draft.name}
            onChange={(event) => form.update({ name: event.target.value })}
            error={Boolean(errors.name)}
            helperText={errors.name}
            slotProps={{ htmlInput: { "data-testid": "clos-name" } }}
          />
          <TextField
            size="small"
            label="Topology file"
            value={draft.fileName}
            onChange={(event) => form.update({ fileName: event.target.value })}
            error={Boolean(errors.fileName)}
            helperText={errors.fileName}
            slotProps={{ htmlInput: { "data-testid": "clos-file-name" } }}
          />
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <SectionTitle step={2} title="Tiers" hint="Each node links to every node of the next tier." />
        {draft.tiers.map((tier, index) => (
          <TierRow
            key={index}
            index={index}
            tier={tier}
            error={errors[`tier${index}`]}
            canRemove={draft.tiers.length > 1}
            onChange={(next) => setTier(index, next)}
            onRemove={() => form.update({ tiers: draft.tiers.filter((_tier, position) => position !== index) })}
          />
        ))}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Button
            size="small"
            variant="text"
            startIcon={<AddRoundedIcon />}
            disabled={draft.tiers.length >= MAX_TIERS}
            onClick={() => {
              const last = draft.tiers.at(-1);
              form.update({ tiers: [...draft.tiers, { count: "2", kind: last?.kind ?? "", type: "" }] });
            }}
            data-testid="clos-add-tier"
          >
            Add tier
          </Button>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${summary.nodes} nodes`} data-testid="clos-summary-nodes" />
          <Chip size="small" label={`${summary.links} links`} data-testid="clos-summary-links" />
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <SectionTitle step={3} title="Images" hint="One per kind." />
        {kinds.map((kind) => (
          <Box key={kind} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1.4fr 1fr" }, gap: 1.5 }}>
            <TextField
              size="small"
              label={`${kind} image`}
              value={draft.images[kind] ?? ""}
              onChange={(event) => form.update({ images: { ...draft.images, [kind]: event.target.value } })}
              error={Boolean(errors[`image:${kind}`])}
              helperText={errors[`image:${kind}`]}
              slotProps={{ htmlInput: { "data-testid": `clos-image-${kind}` } }}
            />
            <TextField
              size="small"
              label="License file"
              placeholder="Optional"
              value={draft.licenses[kind] ?? ""}
              onChange={(event) => form.update({ licenses: { ...draft.licenses, [kind]: event.target.value } })}
              slotProps={{ htmlInput: { "data-testid": `clos-license-${kind}` } }}
            />
          </Box>
        ))}
      </Box>

      <Accordion
        disableGutters
        elevation={0}
        sx={{ border: 1, borderColor: "divider", borderRadius: controlRadius, "&::before": { display: "none" } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} data-testid="clos-advanced">
          <Typography variant="subtitle2">Names and management network</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
          <TextField
            size="small"
            label="Node prefix"
            placeholder="node"
            value={draft.nodePrefix}
            onChange={(event) => form.update({ nodePrefix: event.target.value })}
            slotProps={{ htmlInput: { "data-testid": "clos-node-prefix" } }}
          />
          <TextField
            size="small"
            label="Group prefix"
            placeholder="tier"
            value={draft.groupPrefix}
            onChange={(event) => form.update({ groupPrefix: event.target.value })}
          />
          <TextField
            size="small"
            label="Management network"
            placeholder="clab"
            value={draft.managementNetwork}
            onChange={(event) => form.update({ managementNetwork: event.target.value })}
          />
          <Box />
          <TextField
            size="small"
            label="IPv4 subnet"
            placeholder="172.20.20.0/24"
            value={draft.ipv4Subnet}
            onChange={(event) => form.update({ ipv4Subnet: event.target.value })}
            error={Boolean(errors.ipv4Subnet)}
            helperText={errors.ipv4Subnet}
            slotProps={{ htmlInput: { "data-testid": "clos-ipv4-subnet" } }}
          />
          <TextField
            size="small"
            label="IPv6 subnet"
            placeholder="3fff:172:20:20::/64"
            value={draft.ipv6Subnet}
            onChange={(event) => form.update({ ipv6Subnet: event.target.value })}
            error={Boolean(errors.ipv6Subnet)}
            helperText={errors.ipv6Subnet}
          />
        </AccordionDetails>
      </Accordion>

      <Box
        sx={{
          px: 1.5,
          py: 1,
          border: 1,
          borderColor: "divider",
          borderRadius: controlRadius,
          fontFamily: MONO_FONT_FAMILY,
          fontSize: 12,
          color: "text.secondary",
          overflowWrap: "anywhere"
        }}
        data-testid="clos-command"
      >
        {closGenerateCommand(form.request)}
      </Box>
    </Box>
  );
}
