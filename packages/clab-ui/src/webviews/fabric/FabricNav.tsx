/** The Fabric window's navigation: its views, the lenses and every report. */
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DevicesOtherOutlinedIcon from "@mui/icons-material/DevicesOtherOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import SearchIcon from "@mui/icons-material/Search";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React, { useMemo, useState } from "react";

import { controlRadius } from "../../theme/surfaces";

import { useFabric } from "./fabricContext";
import { matchesReportFind, reportGroups, reportNavTitle } from "./fabricReports";
import type { FabricLensName, FabricRoute } from "./fabricRoute";
import { Pill } from "./fabricUi";

const NAV_WIDTH = 224;
export const NAV_RAIL_WIDTH = 44;

const LENSES: ReadonlyArray<{ name: FabricLensName; title: string; help: string; icon: React.ReactNode }> = [
  { name: "where", title: "Where", help: "Every place in the fabric that knows an IP or MAC address", icon: <PlaceOutlinedIcon fontSize="small" /> },
  { name: "path", title: "Path", help: "How the fabric would forward to an address, hop by hop", icon: <RouteOutlinedIcon fontSize="small" /> },
  { name: "service", title: "Service", help: "Each mac-vrf and ip-vrf on every node that carries it, and what disagrees", icon: <LanOutlinedIcon fontSize="small" /> },
  { name: "endpoints", title: "Endpoints", help: "Every host attached to the fabric, and where", icon: <DevicesOtherOutlinedIcon fontSize="small" /> }
];

const ACTIVE_SX = { bgcolor: "action.selected", color: "text.primary", fontWeight: 600 } as const;

function NavItem({ icon, label, active, collapsed, help, testId, onClick, children }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  help?: string;
  testId: string;
  onClick: () => void;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip title={collapsed ? label : help ?? ""} placement="right">
      <ButtonBase
        data-testid={testId}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        onClick={onClick}
        sx={{
          display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "flex-start", gap: 1, width: "100%", minHeight: 28,
          px: collapsed ? 0 : 1, borderRadius: controlRadius, fontSize: 13, textAlign: "left", color: "text.secondary",
          "&:hover": { bgcolor: "action.hover", color: "text.primary" },
          "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 },
          ...(active ? ACTIVE_SX : {})
        }}
      >
        <Box component="span" sx={{ display: "flex", flexShrink: 0, position: "relative" }}>{icon}</Box>
        {collapsed ? null : (
          <>
            <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</Box>
            {children}
          </>
        )}
      </ButtonBase>
    </Tooltip>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Typography variant="overline" component="h2" sx={{ display: "block", px: 1, pt: 1.5, pb: 0.5, color: "text.secondary" }}>{children}</Typography>;
}

function IncidentCounts(): React.JSX.Element | null {
  const { incidents } = useFabric();
  const open = (incidents ?? []).filter((incident) => !incident.acknowledged);
  const errors = open.filter((incident) => incident.severity === "error").length;
  const warnings = open.filter((incident) => incident.severity === "warning").length;
  if (errors === 0 && warnings === 0) return null;
  return (
    <Box component="span" data-testid="fabric-incident-counts" sx={{ display: "inline-flex", gap: 0.5 }}>
      {errors > 0 ? <Pill tone="bad" title={`${errors} error incidents`}>{errors}</Pill> : null}
      {warnings > 0 ? <Pill tone="warn" title={`${warnings} warning incidents`}>{warnings}</Pill> : null}
    </Box>
  );
}

function ReportsNav({ route, go }: { route: FabricRoute; go: (route: FabricRoute) => void }): React.JSX.Element {
  const { catalog } = useFabric();
  const [find, setFind] = useState("");
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set(["BGP RIB"]));
  const groups = useMemo(() => reportGroups(catalog ?? []), [catalog]);
  const toggle = (title: string) => {
    const next = new Set(closed);
    if (next.has(title)) next.delete(title);
    else next.add(title);
    setClosed(next);
  };
  const searching = find.trim() !== "";
  return (
    <>
      <SectionTitle>Reports</SectionTitle>
      <Box sx={{ px: 0.5, pb: 0.75, pt: 0.25 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Find a report"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          slotProps={{
            htmlInput: { "aria-label": "Find a report", "data-testid": "fabric-report-find" },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }
          }}
        />
      </Box>
      {groups.map((group) => {
        const shown = group.reports.filter((spec) => matchesReportFind(spec, find));
        if (shown.length === 0) return null;
        const open = searching || !closed.has(group.title);
        return (
          <Box key={group.title}>
            <ButtonBase
              aria-expanded={open}
              data-testid={`fabric-report-group-${group.title}`}
              onClick={() => toggle(group.title)}
              sx={{
                display: "flex", alignItems: "center", justifyContent: "flex-start", width: "100%", minHeight: 24, px: 0.5, gap: 0.25,
                borderRadius: controlRadius, fontSize: 12, fontWeight: 500, color: "text.secondary",
                "&:hover": { bgcolor: "action.hover", color: "text.primary" }
              }}
            >
              {open ? <ExpandMoreIcon sx={{ fontSize: 16 }} /> : <ChevronRightIcon sx={{ fontSize: 16 }} />}
              {group.title}
            </ButtonBase>
            {open ? shown.map((spec) => {
              const active = route.view === "report" && route.name === spec.name;
              return (
                <Tooltip key={spec.name} title={spec.help} placement="right" enterDelay={600}>
                  <ButtonBase
                    data-testid={`fabric-report-${spec.name}`}
                    aria-current={active ? "page" : undefined}
                    onClick={() => go({ view: "report", name: spec.name, query: {} })}
                    sx={{
                      display: "block", width: "100%", minHeight: 24, pl: 3, pr: 1, py: 0.25, borderRadius: controlRadius, fontSize: 12, textAlign: "left",
                      color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      "&:hover": { bgcolor: "action.hover", color: "text.primary" },
                      ...(active ? ACTIVE_SX : {})
                    }}
                  >
                    {reportNavTitle(spec.name)}
                  </ButtonBase>
                </Tooltip>
              );
            }) : null}
          </Box>
        );
      })}
    </>
  );
}

/** The panel at full width, or a rail of icons. A rail's Reports opens the panel: reports need their names. */
export function FabricNav({ collapsed, onExpand, onNavigate }: {
  collapsed: boolean;
  onExpand: () => void;
  /** After choosing a view, for a panel over the page to close. */
  onNavigate: () => void;
}): React.JSX.Element {
  const { route, go } = useFabric();
  const navigate = (next: FabricRoute) => {
    go(next);
    onNavigate();
  };
  const viewItem = (view: "topology" | "nodes" | "incidents" | "history", label: string, icon: React.ReactNode, children?: React.ReactNode) => (
    <NavItem
      key={view}
      icon={icon}
      label={label}
      collapsed={collapsed}
      active={route.view === view}
      testId={`fabric-nav-${view}`}
      onClick={() => navigate({ view, query: {} })}
    >
      {children}
    </NavItem>
  );
  return (
    <Box
      component="nav"
      aria-label="Fabric views"
      data-testid="fabric-nav"
      sx={{
        width: collapsed ? NAV_RAIL_WIDTH : NAV_WIDTH, height: "100%", flexShrink: 0, overflowY: "auto", overflowX: "hidden", px: 0.5, py: 0.75,
        bgcolor: "background.paper", borderRight: 1, borderColor: "divider"
      }}
    >
      {viewItem("topology", "Topology", <HubOutlinedIcon fontSize="small" />)}
      {viewItem("nodes", "Nodes", <DnsOutlinedIcon fontSize="small" />)}
      {viewItem("incidents", "Incidents", <ReportProblemOutlinedIcon fontSize="small" />, <IncidentCounts />)}
      {viewItem("history", "History", <HistoryOutlinedIcon fontSize="small" />)}
      {collapsed ? null : <SectionTitle>Lenses</SectionTitle>}
      {LENSES.map((lens) => (
        <NavItem
          key={lens.name}
          icon={lens.icon}
          label={lens.title}
          help={lens.help}
          collapsed={collapsed}
          active={route.view === "lens" && route.name === lens.name}
          testId={`fabric-nav-lens-${lens.name}`}
          onClick={() => navigate({ view: "lens", name: lens.name, query: {} })}
        />
      ))}
      {collapsed ? (
        <NavItem
          icon={<TableChartOutlinedIcon fontSize="small" />}
          label="Reports"
          collapsed
          active={route.view === "report"}
          testId="fabric-nav-reports"
          onClick={onExpand}
        />
      ) : <ReportsNav route={route} go={navigate} />}
    </Box>
  );
}
