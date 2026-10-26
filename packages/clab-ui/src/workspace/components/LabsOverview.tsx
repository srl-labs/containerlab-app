/* eslint-disable import-x/max-dependencies -- Keep individual icon imports tree-shakeable. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import SearchIcon from "@mui/icons-material/Search";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { Theme } from "@mui/material/styles";

import {
  formatLabUptime,
  LAB_RUN_STATE_LABELS,
  type LabOverviewCard,
  type LabRunState,
  type LabThumbnailSources
} from "../state/labsOverview";
import { canWatchLabUsage, type LabUsageUpdate, type WatchLabUsage } from "../state/labUsage";
import type { FetchLabHostMetrics, LabOverviewHost } from "../state/labHostResources";
import { controlRadius, floatingRadius, headerBarHeight } from "../../theme/surfaces";
import { useNow } from "../useNow";
import { LabHostsStrip } from "./LabHostsStrip";
import { LabThumbnailView } from "./LabThumbnailView";
import { LabUsageRow } from "./LabUsageRow";
import { InViewRootContext, useInView, useSeen } from "./useInView";

const PREFERENCES_KEY = "clab.workspace.labsOverview.v1";
const CARD_MIN_WIDTH = 232;

type SectionId = "hosts" | "running" | "undeployed";
const SECTION_IDS: readonly SectionId[] = ["hosts", "running", "undeployed"];
type StateFilter = "all" | "running" | "partial" | "stopped" | "undeployed";

const STATE_FILTERS: ReadonlyArray<{ id: Exclude<StateFilter, "all">; label: string }> = [
  { id: "running", label: "Running" },
  { id: "partial", label: "Partially running" },
  { id: "stopped", label: "Stopped or failed" },
  { id: "undeployed", label: "Not deployed" }
];

export interface LabsOverviewProps {
  cards: LabOverviewCard[];
  /** The first listing of topology files has not finished. */
  loading?: boolean;
  /** Without lab lifecycle (the browser sandbox) nothing runs, so there is one section. */
  lifecycleAvailable: boolean;
  /** Show each card's lab host, when there is more than one. */
  showEndpoints: boolean;
  /** The lab hosts, shown above the cards with their free resources when `fetchHostMetrics` is given too. */
  labHosts?: LabOverviewHost[];
  fetchHostMetrics?: FetchLabHostMetrics;
  loadSources: (card: LabOverviewCard) => Promise<LabThumbnailSources | undefined>;
  /** Changes when topology files change, so visible thumbnails draw again. */
  sourcesRevision: number;
  /** Follows the CPU and memory usage of running labs whose cards are visible; without it cards show none. */
  watchUsage?: WatchLabUsage;
  onOpen: (card: LabOverviewCard) => void;
  onDeploy: (card: LabOverviewCard) => void;
  onDestroy: (card: LabOverviewCard) => void;
  /** Copies a card's link; without it cards offer none. */
  onCopyLink?: (card: LabOverviewCard) => void;
  onCreateLab: () => void;
  /** Closes the overview; without it, as in its own editor tab, there is no close button. */
  onClose?: () => void;
}

function readCollapsed(): Set<SectionId> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "null");
    const collapsed = typeof value === "object" && value !== null && "collapsed" in value ? value.collapsed : [];
    return new Set(Array.isArray(collapsed) ? collapsed.filter((id): id is SectionId => SECTION_IDS.some((section) => section === id)) : []);
  } catch {
    return new Set();
  }
}

function persistCollapsed(collapsed: ReadonlySet<SectionId>): void {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ collapsed: [...collapsed] }));
  } catch {
    // Storage can be disabled.
  }
}

function stateColor(theme: Theme, state: LabRunState): string {
  if (state === "running") return theme.palette.success.main;
  if (state === "partial") return theme.palette.warning.main;
  if (state === "undeployed") return theme.palette.text.secondary;
  return theme.palette.error.main;
}

function matchesState(card: LabOverviewCard, filter: StateFilter): boolean {
  if (filter === "all") return true;
  if (filter === "stopped") return card.state === "stopped" || card.state === "failed";
  return card.state === filter;
}

function matchesQuery(card: LabOverviewCard, query: string): boolean {
  if (!query) return true;
  return [card.name, card.path, card.owner, card.endpointLabel]
    .some((value) => value?.toLowerCase().includes(query));
}

function ownerLabel(card: LabOverviewCard): string | undefined {
  return card.shared ? "Shared workspace" : card.owner;
}

function cardSummary(card: LabOverviewCard): string {
  if (card.state === "undeployed") return card.path ?? "";
  const nodes = card.nodeCount === 1 ? "node" : "nodes";
  return `${card.readyCount} of ${card.nodeCount} ${nodes} ready`;
}

/** The usage of the card's lab while the card is visible, kept while it scrolls away. */
function useLabUsage(card: LabOverviewCard, watch: WatchLabUsage | undefined, inView: boolean): LabUsageUpdate | undefined {
  const [update, setUpdate] = useState<LabUsageUpdate>();
  const watchable = watch !== undefined && canWatchLabUsage(card);
  const cardRef = useRef(card);
  useEffect(() => {
    cardRef.current = card;
  });
  useEffect(() => {
    if (!watch || !watchable || !inView) return undefined;
    return watch(cardRef.current, setUpdate);
  }, [watch, watchable, inView, card.id, card.labName]);
  return watchable ? update ?? { status: "pending" } : undefined;
}

/** Name and summary, then the lab's usage while the lab host reports it. */
function CardText({ card, usage, tight }: { card: LabOverviewCard; usage: LabUsageUpdate | undefined; tight: boolean }) {
  const showUsage = usage !== undefined && usage.status !== "unavailable";
  return (
    <>
      <Box sx={{ px: 1.25, pt: 1, pb: tight && !showUsage ? 0.25 : 1, borderTop: 1, borderColor: "divider", minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap title={card.name}>{card.name}</Typography>
        <Typography variant="caption" component="p" noWrap title={card.path} sx={{ color: "text.secondary" }}>
          {cardSummary(card)}
        </Typography>
      </Box>
      {showUsage ? <LabUsageRow usage={usage.status === "live" ? usage.usage : undefined} /> : null}
    </>
  );
}

function LabCard({ card, now, showEndpoint, lifecycleAvailable, loadSources, sourcesRevision, watchUsage, onOpen, onDeploy, onDestroy, onCopyLink }: {
  card: LabOverviewCard;
  now: number;
  showEndpoint: boolean;
} & Pick<LabsOverviewProps, "lifecycleAvailable" | "loadSources" | "sourcesRevision" | "watchUsage" | "onOpen" | "onDeploy" | "onDestroy" | "onCopyLink">) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const seen = useSeen(inView);
  const usage = useLabUsage(card, watchUsage, inView);
  const live = usage?.status === "live" ? usage.usage : undefined;
  const uptime = card.startedAt === undefined
    ? undefined
    : `up ${formatLabUptime(Math.max(0, now - card.startedAt), card.uptimePrecisionMs)}`;
  const details = [ownerLabel(card), showEndpoint ? card.endpointLabel : undefined].filter(Boolean).join(" · ");
  return (
    <Box
      ref={ref}
      component="article"
      aria-label={card.name}
      data-testid={`lab-card-${card.id}`}
      data-state={card.state}
      sx={{
        display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden",
        border: 1, borderColor: "divider", borderRadius: floatingRadius, bgcolor: "background.paper",
        transition: "border-color 120ms ease, box-shadow 120ms ease",
        "&:hover, &:focus-within": { borderColor: "var(--clab-ui-focus-border, var(--vscode-focusBorder))" },
        "@media (prefers-reduced-motion: reduce)": { transition: "none" }
      }}
    >
      <ButtonBase
        aria-label={`Open ${card.name}`}
        disabled={!card.topologyRef}
        onClick={() => onOpen(card)}
        sx={{
          display: "flex", flexDirection: "column", alignItems: "stretch", textAlign: "left", width: "100%",
          "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 }
        }}
      >
        <Box
          data-testid="lab-card-state"
          sx={(theme) => ({
            display: "flex", alignItems: "center", gap: 0.75, height: 28, px: 1.25,
            bgcolor: `color-mix(in srgb, ${stateColor(theme, card.state)} 16%, ${theme.palette.background.paper})`,
            borderBottom: 1, borderColor: "divider"
          })}
        >
          <Box sx={(theme) => ({ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, bgcolor: stateColor(theme, card.state) })} />
          <Typography component="span" variant="caption" noWrap sx={{ fontWeight: 600, flex: 1, minWidth: 0 }}>
            {LAB_RUN_STATE_LABELS[card.state]}
          </Typography>
          {uptime ? (
            <Typography component="span" variant="caption" noWrap sx={{ color: "text.secondary", flexShrink: 0 }}>
              {uptime}
            </Typography>
          ) : null}
        </Box>
        <LabThumbnailView card={card} loadSources={loadSources} revision={sourcesRevision} seen={seen} usage={live?.nodes} />
        <CardText card={card} usage={usage} tight={details !== ""} />
      </ButtonBase>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, minHeight: 32, pl: 1.25, pr: 0.5, pb: 0.25 }}>
        <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, color: "text.secondary" }} title={details}>
          {details}
        </Typography>
        {lifecycleAvailable && card.canDeploy ? (
          <Tooltip title="Deploy">
            <IconButton size="small" aria-label={`Deploy ${card.name}`} onClick={() => onDeploy(card)}>
              <PlayArrowOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {lifecycleAvailable && card.canDestroy ? (
          <Tooltip title="Destroy">
            <IconButton size="small" aria-label={`Destroy ${card.name}`} onClick={() => onDestroy(card)}>
              <StopCircleOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
        {card.link && onCopyLink ? (
          <Tooltip title="Copy link">
            <IconButton size="small" aria-label={`Copy link to ${card.name}`} onClick={() => onCopyLink(card)}>
              <LinkOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
    </Box>
  );
}

function Section({ id, label, count, collapsed, onToggle, children }: {
  id: SectionId;
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const regionId = `labs-overview-section-${id}`;
  return (
    <Box component="section" aria-label={label} data-testid={regionId} sx={{ mb: 2 }}>
      <ButtonBase
        aria-expanded={!collapsed}
        aria-controls={`${regionId}-cards`}
        onClick={onToggle}
        sx={{
          display: "flex", alignItems: "center", gap: 0.5, py: 0.5, pr: 1, mb: 1, borderRadius: controlRadius,
          color: "text.primary",
          "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))" }
        }}
      >
        <ExpandMoreIcon fontSize="small" sx={{
          transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 120ms ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" }
        }} />
        <Typography component="h2" variant="subtitle2">{label}</Typography>
        <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>{count}</Typography>
      </ButtonBase>
      {collapsed ? null : <Box id={`${regionId}-cards`}>{children}</Box>}
    </Box>
  );
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${CARD_MIN_WIDTH}px, 1fr))`, gap: 1.5 }}>
      {children}
    </Box>
  );
}

function FilterSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 140 }}
      // "All" has the empty value, which a select hides unless told to show it.
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
    >
      <MenuItem value="">All</MenuItem>
      {options.map((option) => <MenuItem key={option} value={option}>{option}</MenuItem>)}
    </TextField>
  );
}

function EmptyMessage({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 1, py: 8, px: 2 }}>
      <AccountTreeOutlinedIcon sx={{ fontSize: 40, color: "text.disabled" }} />
      <Typography variant="subtitle1">{title}</Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 420 }}>{detail}</Typography>
      {action}
    </Box>
  );
}

interface Filters {
  state: StateFilter;
  owner: string;
  endpoint: string;
  query: string;
}

const NO_FILTERS: Filters = { state: "all", owner: "", endpoint: "", query: "" };

function matchesFilters(card: LabOverviewCard, filters: Filters): boolean {
  return matchesState(card, filters.state) &&
    (filters.owner === "" || ownerLabel(card) === filters.owner) &&
    (filters.endpoint === "" || card.endpointLabel === filters.endpoint) &&
    matchesQuery(card, filters.query.trim().toLowerCase());
}

function FilterBar({ cards, filters, lifecycleAvailable, onChange }: {
  cards: LabOverviewCard[];
  filters: Filters;
  lifecycleAvailable: boolean;
  onChange: (filters: Filters) => void;
}) {
  const owners = useMemo(
    () => [...new Set(cards.map(ownerLabel).filter((value): value is string => Boolean(value)))].sort(),
    [cards]
  );
  const endpoints = useMemo(() => [...new Set(cards.map((card) => card.endpointLabel))].sort(), [cards]);
  const filtersActive = filters.state !== "all" || filters.owner !== "" || filters.endpoint !== "" || filters.query.trim() !== "";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 2, pt: 1.5, pb: 1, flexShrink: 0 }}>
      <TextField
        size="small"
        placeholder="Search labs"
        value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
        slotProps={{
          htmlInput: { "aria-label": "Search labs", "data-testid": "labs-overview-search" },
          input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }
        }}
        sx={{ width: 220 }}
      />
      {lifecycleAvailable ? (
        <Box role="group" aria-label="Filter by state" sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
          {STATE_FILTERS.map((filter) => {
            const count = cards.filter((card) => matchesState(card, filter.id)).length;
            const selected = filters.state === filter.id;
            return (
              <Chip
                key={filter.id}
                size="small"
                label={`${filter.label} ${count}`}
                aria-pressed={selected}
                data-testid={`labs-overview-filter-${filter.id}`}
                color={selected ? "primary" : "default"}
                variant={selected ? "filled" : "outlined"}
                onClick={() => onChange({ ...filters, state: selected ? "all" : filter.id })}
                sx={{ borderRadius: controlRadius }}
              />
            );
          })}
        </Box>
      ) : null}
      {owners.length > 1 ? (
        <FilterSelect label="Owner" value={filters.owner} options={owners} onChange={(owner) => onChange({ ...filters, owner })} />
      ) : null}
      {endpoints.length > 1 ? (
        <FilterSelect label="Lab host" value={filters.endpoint} options={endpoints} onChange={(endpoint) => onChange({ ...filters, endpoint })} />
      ) : null}
      {filtersActive ? <Button size="small" variant="text" onClick={() => onChange(NO_FILTERS)}>Clear filters</Button> : null}
    </Box>
  );
}

function OverviewSections({ props, filtered, collapsed, onToggle, onClearFilters }: {
  props: LabsOverviewProps;
  filtered: LabOverviewCard[];
  collapsed: ReadonlySet<SectionId>;
  onToggle: (id: SectionId) => void;
  onClearFilters: () => void;
}) {
  const now = useNow(60_000);
  if (props.cards.length === 0) {
    return props.loading === true
      ? <Typography variant="body2" sx={{ color: "text.secondary", p: 2 }}>Loading labs…</Typography>
      : (
        <EmptyMessage
          title="No labs yet"
          detail="A lab starts as a topology file. Create one, add nodes and links, then deploy it."
          action={<Button variant="contained" startIcon={<AddIcon />} onClick={props.onCreateLab} sx={{ mt: 1 }}>Create your first lab</Button>}
        />
      );
  }
  if (filtered.length === 0) {
    return (
      <EmptyMessage
        title="No labs match"
        detail="No lab matches the search and filters."
        action={<Button variant="text" onClick={onClearFilters}>Clear filters</Button>}
      />
    );
  }
  const renderCards = (sectionCards: LabOverviewCard[]) => sectionCards.map((card) => (
    <LabCard
      key={card.id}
      card={card}
      now={now}
      showEndpoint={props.showEndpoints}
      lifecycleAvailable={props.lifecycleAvailable}
      loadSources={props.loadSources}
      sourcesRevision={props.sourcesRevision}
      watchUsage={props.watchUsage}
      onOpen={props.onOpen}
      onDeploy={props.onDeploy}
      onDestroy={props.onDestroy}
      onCopyLink={props.onCopyLink}
    />
  ));
  const running = filtered.filter((card) => card.state !== "undeployed");
  const undeployed = filtered.filter((card) => card.state === "undeployed");
  return (
    <>
      {props.lifecycleAvailable && running.length > 0 ? (
        <Section id="running" label="Running" count={running.length} collapsed={collapsed.has("running")} onToggle={() => onToggle("running")}>
          <CardGrid>{renderCards(running)}</CardGrid>
        </Section>
      ) : null}
      {undeployed.length > 0 ? (
        <Section id="undeployed" label="Not deployed" count={undeployed.length} collapsed={collapsed.has("undeployed")} onToggle={() => onToggle("undeployed")}>
          <CardGrid>{renderCards(undeployed)}</CardGrid>
        </Section>
      ) : null}
    </>
  );
}

/**
 * Every lab on every lab host as cards: running labs with their state and readiness,
 * and topology files nobody deployed. The explorer stays the dense view.
 */
export function LabsOverview(props: LabsOverviewProps): React.JSX.Element {
  const { cards, lifecycleAvailable, labHosts, fetchHostMetrics, onClose, onCreateLab } = props;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = (id: SectionId) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    persistCollapsed(next);
  };
  const showHosts = lifecycleAvailable && fetchHostMetrics !== undefined && labHosts !== undefined && labHosts.length > 0;
  // Cards watch their visibility within the scrolling list.
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const filtered = cards.filter((card) => matchesFilters(card, filters));
  return (
    <Box
      id="labs-overview"
      data-testid="labs-overview"
      sx={{
        position: "absolute", inset: 0, display: "flex", flexDirection: "column", minHeight: 0,
        bgcolor: "background.default", color: "text.primary", pointerEvents: "auto"
      }}
    >
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1, height: headerBarHeight, flexShrink: 0, pl: 1.5, pr: 1,
        borderBottom: 1, borderColor: "divider"
      }}>
        <Typography component="h1" variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
          Labs overview
          <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
            {cards.length} {cards.length === 1 ? "lab" : "labs"}
          </Typography>
        </Typography>
        <Button size="small" variant="text" startIcon={<AddIcon />} onClick={onCreateLab}>New lab</Button>
        {onClose ? (
          <IconButton size="small" aria-label="Close labs overview" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        ) : null}
      </Box>
      {cards.length > 0 ? (
        <FilterBar cards={cards} filters={filters} lifecycleAvailable={lifecycleAvailable} onChange={setFilters} />
      ) : null}
      <Box ref={setScrollRoot} sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, pt: 0.5, pb: 2 }}>
        <InViewRootContext.Provider value={scrollRoot}>
          {showHosts ? (
            <Section id="hosts" label="Lab hosts" count={labHosts.length} collapsed={collapsed.has("hosts")} onToggle={() => toggle("hosts")}>
              <LabHostsStrip
                hosts={labHosts}
                cards={cards}
                fetchMetrics={fetchHostMetrics}
                selectedLabel={filters.endpoint}
                onSelect={(endpoint) => setFilters({ ...filters, endpoint })}
              />
            </Section>
          ) : null}
          <OverviewSections
            props={props}
            filtered={filtered}
            collapsed={collapsed}
            onToggle={toggle}
            onClearFilters={() => setFilters(NO_FILTERS)}
          />
        </InViewRootContext.Provider>
      </Box>
    </Box>
  );
}
