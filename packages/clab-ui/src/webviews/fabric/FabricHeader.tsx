/** The top of the Fabric window: which lab, whether it is live, and going back in time. */
import HistoryIcon from "@mui/icons-material/History";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemIcon from "@mui/material/ListItemIcon";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";

import { controlRadius } from "../../theme/surfaces";

import { GnmiPortDialog } from "./FabricGnmiPort";
import { useFabric } from "./fabricContext";
import type { FabricConnection } from "./fabricData";
import { ago, clock } from "./fabricFormat";
import { parseInstant } from "./fabricTime";
import { tint, toneColor, type FabricTone } from "./fabricUi";

const CONNECTION_LOOK: Readonly<Record<FabricConnection, { label: string; tone: FabricTone; title: string }>> = {
  connecting: { label: "Connecting", tone: "warn", title: "Opening the engine's event stream" },
  live: { label: "Live", tone: "good", title: "Following the engine's events" },
  reconnecting: { label: "Reconnecting", tone: "warn", title: "The event stream ended; opening it again" },
  paused: { label: "Paused", tone: "neutral", title: "Not following changes" }
};

function ConnectionState(): React.JSX.Element {
  const { connection, at } = useFabric();
  const look = CONNECTION_LOOK[connection];
  return (
    <Tooltip title={at === undefined ? look.title : "Showing the past: not following changes"}>
      <Box data-testid="fabric-connection" data-state={connection} sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: toneColor(look.tone) }} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>{look.label}</Typography>
      </Box>
    </Tooltip>
  );
}

function NodesLive(): React.JSX.Element | null {
  const { status, go } = useFabric();
  if (!status) return null;
  const down = status.nodes.filter((node) => node.status !== "live");
  const live = status.nodes.length - down.length;
  return (
    <Tooltip title={down.length > 0 ? down.map((node) => `${node.name}: ${node.status}`).join(", ") : "gNMI stream of every node"}>
      <ButtonBase
        data-testid="fabric-nodes-live"
        onClick={() => go({ view: "nodes", query: {} })}
        sx={{
          px: 0.75, height: 24, borderRadius: controlRadius, fontSize: 12, flexShrink: 0,
          color: down.length > 0 ? "warning.main" : "text.secondary",
          "&:hover": { bgcolor: "action.hover" }
        }}
      >
        {live}/{status.nodes.length} nodes live
      </ButtonBase>
    </Tooltip>
  );
}

function GoBack(): React.JSX.Element | null {
  const { at, setAt } = useFabric();
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  if (at !== undefined) return null;
  return (
    <Box
      component="form"
      onSubmit={(event: React.FormEvent) => {
        event.preventDefault();
        const instant = parseInstant(text);
        setInvalid(instant === undefined);
        if (instant !== undefined) {
          setAt(instant);
          setText("");
        }
      }}
      sx={{ flexShrink: 0 }}
    >
      <Tooltip title={invalid ? "Not a time: try 30m, 2h or 14:02" : "Show the fabric as it was: 30m, 2h, 14:02"}>
        <TextField
          size="small"
          placeholder="Go back: 30m, 2h, 14:02"
          value={text}
          error={invalid}
          onChange={(event) => {
            setText(event.target.value);
            setInvalid(false);
          }}
          slotProps={{
            htmlInput: { "aria-label": "Go back to", "data-testid": "fabric-go-back" },
            input: { startAdornment: <InputAdornment position="start"><HistoryIcon fontSize="small" /></InputAdornment> }
          }}
          sx={{ width: 204 }}
        />
      </Tooltip>
    </Box>
  );
}

function EngineMenu(): React.JSX.Element {
  const { stopEngine, gnmiPort, changeGnmiPort } = useFabric();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [changingPort, setChangingPort] = useState(false);
  return (
    <>
      <Tooltip title="More">
        <IconButton size="small" aria-label="More" data-testid="fabric-menu" onClick={(event) => setAnchor(event.currentTarget)}>
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {gnmiPort === undefined ? null : (
          <MenuItem
            data-testid="fabric-gnmi-port"
            onClick={() => {
              setAnchor(null);
              setChangingPort(true);
            }}
          >
            <ListItemIcon><LanOutlinedIcon fontSize="small" /></ListItemIcon>
            gNMI port: {gnmiPort}
          </MenuItem>
        )}
        <MenuItem
          data-testid="fabric-stop-engine"
          onClick={() => {
            setAnchor(null);
            stopEngine();
          }}
        >
          <ListItemIcon><PowerSettingsNewIcon fontSize="small" /></ListItemIcon>
          Stop engine
        </MenuItem>
      </Menu>
      {changingPort && gnmiPort !== undefined ? (
        <GnmiPortDialog gnmiPort={gnmiPort} onClose={() => setChangingPort(false)} onChange={changeGnmiPort} />
      ) : null}
    </>
  );
}

export function FabricHeader({ onToggleNav }: { onToggleNav: () => void }): React.JSX.Element {
  const { labName } = useFabric();
  return (
    <Box
      sx={{
        display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", minHeight: 44, flexShrink: 0, pl: 0.75, pr: 0.75, py: 0.5,
        borderBottom: 1, borderColor: "divider"
      }}
    >
      <Tooltip title="Show or hide the navigation">
        <IconButton size="small" aria-label="Navigation" data-testid="fabric-nav-toggle" onClick={onToggleNav}>
          <MenuIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Typography component="h1" variant="subtitle2" noWrap sx={{ flex: "1 1 120px", minWidth: 0 }}>
        Fabric
        <Typography component="span" variant="caption" data-testid="fabric-lab-name" sx={{ color: "text.secondary", ml: 1 }}>{labName}</Typography>
      </Typography>
      <NodesLive />
      <ConnectionState />
      <GoBack />
      <EngineMenu />
    </Box>
  );
}

/** No node reached usually means the wrong port: the engine itself is fine with that. */
export function FabricNodesDownBanner(): React.JSX.Element | null {
  const { status, at, gnmiPort, changeGnmiPort } = useFabric();
  const [changingPort, setChangingPort] = useState(false);
  const nodes = status?.nodes ?? [];
  if (at !== undefined || gnmiPort === undefined || nodes.length === 0) return null;
  if (nodes.some((node) => node.status !== "down")) return null;
  const warn = toneColor("warn");
  return (
    <Box
      role="status"
      data-testid="fabric-nodes-down-banner"
      sx={{
        display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 1.5, py: 0.5, flexShrink: 0,
        bgcolor: tint(warn, 12), borderBottom: `1px solid ${tint(warn, 34)}`
      }}
    >
      <LanOutlinedIcon fontSize="small" sx={{ color: "warning.main" }} />
      <Typography variant="body2" sx={{ flex: "1 1 240px", minWidth: 0 }}>
        No node can be reached. The engine looks for them on gNMI port <b>{gnmiPort}</b>.
      </Typography>
      <Button size="small" variant="outlined" data-testid="fabric-gnmi-port-change" onClick={() => setChangingPort(true)}>Change port</Button>
      {changingPort ? (
        <GnmiPortDialog gnmiPort={gnmiPort} onClose={() => setChangingPort(false)} onChange={changeGnmiPort} />
      ) : null}
    </Box>
  );
}

/** Says plainly that what is shown is not now, with the way back. */
export function FabricPastBanner(): React.JSX.Element | null {
  const { at, setAt, coreError } = useFabric();
  if (at === undefined) return null;
  const warn = toneColor("warn");
  return (
    <Box
      role="status"
      data-testid="fabric-past-banner"
      sx={{
        display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 1.5, py: 0.5, flexShrink: 0,
        bgcolor: tint(warn, 12), borderBottom: `1px solid ${tint(warn, 34)}`
      }}
    >
      <HistoryIcon fontSize="small" sx={{ color: "warning.main" }} />
      <Typography variant="body2" sx={{ flex: "1 1 240px", minWidth: 0 }}>
        {coreError ?? <>Viewing the fabric as it was at <b>{clock(at)}</b> ({ago(at)}). Changes are not followed.</>}
      </Typography>
      <Button size="small" variant="outlined" data-testid="fabric-back-to-live" onClick={() => setAt(undefined)}>Back to live</Button>
    </Box>
  );
}
