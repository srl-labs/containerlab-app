/** Each service on every node that carries it, and what disagrees. */
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LanOutlinedIcon from "@mui/icons-material/LanOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import React, { useMemo, useState } from "react";

import { floatingRadius } from "../../theme/surfaces";

import { useFabric } from "./fabricContext";
import { useLensAnswer } from "./fabricLensAnswer";
import { plural } from "./fabricFormat";
import { disagreeingRts, serviceCards, type FabricServiceCard } from "./fabricLenses";
import { nodeRoute, reportRoute } from "./fabricRoute";
import type { FabricServicePort, FabricServiceRecord } from "./fabricTypes";
import { EmptyState, ErrorNote, INLINE_TABLE_SX, LoadingNote, MONO_SX, Pill, TextLink, ViewHeader, type FabricTone } from "./fabricUi";

const KINDS = [
  ["mac-vrf", "Bridge domains"],
  ["ip-vrf", "Routers"]
] as const;

const STATE_TONES: Readonly<Record<string, FabricTone>> = { up: "good", down: "bad", mixed: "warn" };

function portsText(ports: readonly FabricServicePort[]): string {
  return ports
    .map((port) => {
      if (port.kind === "irb") return port.peer_ni ? `${port.name} → ${port.peer_ni}` : port.name;
      return port.segment ? `${port.name} ${port.segment}` : port.name;
    })
    .join(", ");
}

function rtsOf(row: FabricServiceRecord): string[] {
  return [...new Set((row.vpn ?? []).flatMap((vpn) => vpn.import_rts ?? []))].sort();
}

function cardFacts(card: FabricServiceCard): string {
  return [
    card.sites.length > 1 ? plural(card.sites.length, "site") : card.sites[0],
    plural(card.nodes.length, "node"),
    card.vnis.length > 0 ? `VNI ${card.vnis.join(", ")}` : "",
    card.rts.length > 0 ? `RT ${card.rts.join(", ")}` : "",
    card.type === "mac-vrf" ? plural(card.macs, "local MAC") : ""
  ].filter(Boolean).join(" · ");
}

function ServiceCard({ card, defaultOpen }: { card: FabricServiceCard; defaultOpen: boolean }): React.JSX.Element {
  const { go } = useFabric();
  const [open, setOpen] = useState(defaultOpen);
  const lonely = useMemo(() => disagreeingRts(card), [card]);
  const bridged = card.type === "mac-vrf";
  const anyFilter = (values: readonly string[]) => values.map((value) => `=${value}`).join("|");
  const tables = bridged
    ? ([["mac", "MAC table"]] as const)
    : ([["arp", "ARP"], ["nd", "ND"], ["ipv4-rib", "IPv4 RIB"], ["ipv6-rib", "IPv6 RIB"]] as const);
  return (
    <Box
      component="section"
      data-testid={`fabric-service-${card.id}`}
      data-state={card.state}
      sx={{ border: 1, borderColor: "divider", borderRadius: floatingRadius, bgcolor: "background.paper", overflow: "hidden" }}
    >
      <ButtonBase
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        sx={{
          display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 1, flexWrap: "wrap", width: "100%", textAlign: "left", px: 1, py: 0.75,
          "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 }
        }}
      >
        {open ? <ExpandMoreIcon fontSize="small" sx={{ color: "text.secondary" }} /> : <ChevronRightIcon fontSize="small" sx={{ color: "text.secondary" }} />}
        <Typography component="h3" variant="subtitle2" sx={MONO_SX}>{card.names.join(" / ")}</Typography>
        <Pill dot tone={STATE_TONES[card.state] ?? "neutral"}>{card.state}</Pill>
        {card.dci ? <Pill tone="info">{card.dci}</Pill> : null}
        {card.issues > 0 ? <Pill tone="bad">{plural(card.issues, "issue")}</Pill> : null}
        <Typography variant="caption" sx={{ color: "text.secondary", flex: "1 1 200px", minWidth: 0 }}>{cardFacts(card)}</Typography>
      </ButtonBase>
      {open ? (
        <Box sx={{ borderTop: 1, borderColor: "divider", p: 1 }}>
          <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap", mb: 0.75, fontSize: 12 }}>
            {card.subnets.map((subnet) => <Pill key={subnet}>{subnet}</Pill>)}
            {tables.map(([report, label]) => (
              <TextLink
                key={report}
                onClick={() => go(reportRoute(report, { "f.NI": anyFilter(card.names), "f.Node": anyFilter(card.nodes) }))}
              >
                {label}
              </TextLink>
            ))}
          </Box>
          <Box sx={{ overflowX: "auto" }}>
            <Box component="table" sx={INLINE_TABLE_SX}>
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Oper</th>
                  {card.sites.length > 1 ? <th>Site</th> : null}
                  <th>VNI</th>
                  <th>EVI</th>
                  <th>Route-targets</th>
                  <th>{bridged ? "Access / IRB" : "Interfaces"}</th>
                  {bridged ? <th>MACs</th> : null}
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {card.rows.map((row) => (
                  <tr key={`${row.node}|${row.name}`} data-testid={`fabric-service-row-${row.node}`}>
                    <td>
                      <TextLink onClick={() => go(nodeRoute(row.node))}>{row.node}</TextLink>
                      {row.gateway ? <> <Pill tone="info">GW</Pill></> : null}
                    </td>
                    <td><Pill dot tone={row.oper === "up" ? "good" : "bad"}>{row.oper || "?"}</Pill></td>
                    {card.sites.length > 1 ? <td>{row.site}</td> : null}
                    <td>{(row.vnis ?? []).join(", ") || "—"}</td>
                    <td>{(row.evis ?? []).join(", ") || "—"}</td>
                    <td>
                      <Box component="span" sx={MONO_SX}>
                        {rtsOf(row).map((rt, index) => {
                          const differs = lonely.get(row.node)?.includes(rt) === true;
                          return (
                            <React.Fragment key={rt}>
                              {index > 0 ? ", " : ""}
                              <Box component="span" title={differs ? "No other node of this service has it" : undefined} sx={differs ? { color: "warning.main", fontWeight: 600 } : undefined}>{rt}</Box>
                            </React.Fragment>
                          );
                        })}
                        {rtsOf(row).length === 0 ? "—" : null}
                      </Box>
                    </td>
                    <td><Box component="span" sx={MONO_SX}>{portsText(row.ports ?? []) || "—"}</Box></td>
                    {bridged ? <td>{row.macs_local ?? 0} <Box component="span" sx={{ color: "text.secondary" }}>/ {row.macs_remote ?? 0}</Box></td> : null}
                    <td>
                      {(row.issues ?? []).map((issue) => (
                        <Typography key={issue} variant="caption" component="div" sx={{ color: "error.main" }}>{issue}</Typography>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Box>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}

export function FabricServiceLens(): React.JSX.Element {
  const { answer, error, loading } = useLensAnswer<FabricServiceRecord>("service", {}, true);
  const [kind, setKind] = useState<string>("mac-vrf");
  const [find, setFind] = useState("");
  const cards = useMemo(() => serviceCards(answer?.records ?? []), [answer]);
  const term = find.trim().toLowerCase();
  const shown = cards
    .filter((card) => card.type === kind)
    .filter((card) => !term || card.names.some((name) => name.toLowerCase().includes(term)) || card.nodes.some((node) => node.toLowerCase().includes(term)));
  const kindLabel = KINDS.find(([value]) => value === kind)?.[1].toLowerCase() ?? "services";
  return (
    <Box data-testid="fabric-lens-service" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader title="Service" detail="Each mac-vrf and ip-vrf on every node that carries it, and what disagrees." />
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 2, pb: 1.25, flexShrink: 0 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={kind}
          aria-label="Kind of service"
          onChange={(_event, value: string | null) => {
            if (value) setKind(value);
          }}
        >
          {KINDS.map(([value, label]) => (
            <ToggleButton key={value} value={value} data-testid={`fabric-service-kind-${value}`} sx={{ px: 1 }}>
              {label} {cards.filter((card) => card.type === value).length}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Filter by name or node"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          slotProps={{
            htmlInput: { "aria-label": "Filter services" },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }
          }}
          sx={{ width: 220 }}
        />
      </Box>
      {error ? <ErrorNote sx={{ mx: 2 }}>{error}</ErrorNote> : null}
      {!answer && loading ? <LoadingNote label="Asking the fabric…" sx={{ px: 2 }} /> : null}
      {answer ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 2, pb: 2, display: "flex", flexDirection: "column", gap: 1 }}>
          {shown.length > 0 ? shown.map((card, index) => (
            <ServiceCard key={card.id} card={card} defaultOpen={card.issues > 0 || (index === 0 && shown.length <= 3)} />
          )) : (
            <EmptyState
              icon={<LanOutlinedIcon />}
              title={term ? `No ${kindLabel} match “${find}”` : `No ${kindLabel}`}
              detail={term ? undefined : "This fabric carries none of them."}
            />
          )}
        </Box>
      ) : null}
    </Box>
  );
}
