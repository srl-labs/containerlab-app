/** The panel beside the drawing: what the selected node, cable or client is, and what is wrong with it. */
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import React, { useMemo } from "react";

import { useFabric } from "./fabricContext";
import { useFabricAnswer } from "./fabricData";
import { ago, formatBps } from "./fabricFormat";
import { nodeRoute } from "./fabricRoute";
import { linkId, type FabricSelection } from "./FabricTopologyCanvas";
import type {
  FabricAttachedClient,
  FabricFinding,
  FabricLink,
  FabricRecord,
  FabricTableAnswer,
  FabricTopology,
  FabricTopologyNode
} from "./fabricTypes";
import { ErrorNote, FieldList, LoadingNote, MONO_SX, Pill, SECTION_TITLE_SX, SEVERITY_TONES, TextLink, toneColor, type FabricTone } from "./fabricUi";

const CABLE_TONES: Readonly<Record<string, FabricTone>> = { up: "good", mixed: "warn", down: "bad", lost: "bad" };

function SectionTitle({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Typography variant="overline" component="h3" sx={SECTION_TITLE_SX}>{children}</Typography>;
}

function FindingsList({ findings }: { findings: readonly FabricFinding[] }): React.JSX.Element {
  const faults = findings.filter((finding) => finding.severity !== "info");
  const info = findings.length - faults.length;
  if (findings.length === 0) return <Typography variant="body2" sx={{ color: "text.secondary" }}>Nothing wrong.</Typography>;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
      {faults.map((finding) => (
        <Box key={`${finding.node}|${finding.check}|${finding.subject}`} data-testid="fabric-details-finding" sx={{ display: "flex", gap: 0.75, fontSize: 12 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: "50%", mt: "5px", flexShrink: 0, bgcolor: toneColor(SEVERITY_TONES[finding.severity]) }} />
          <Box sx={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <b>{finding.check}</b> <Box component="span" sx={MONO_SX}>{finding.subject}</Box>
            <Box sx={{ color: "text.secondary" }}>{finding.detail}</Box>
          </Box>
        </Box>
      ))}
      {info > 0 ? <Typography variant="caption" sx={{ color: "text.secondary" }}>{info} for information only</Typography> : null}
    </Box>
  );
}

function useFindings(nodes: readonly string[]) {
  const { client, at, topology } = useFabric();
  return useFabricAnswer<FabricFinding[]>(
    client,
    { method: "GET", path: "checks", query: { node: [...nodes], at: at === undefined ? undefined : String(at) } },
    // The drawing has been read again: its findings may have moved.
    JSON.stringify(topology?.nodes.filter((node) => nodes.includes(node.name)).map((node) => node.findings))
  );
}

function textOf(record: FabricRecord | undefined, field: string): string {
  const value = record?.[field];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function mono(value: string | undefined): React.ReactNode {
  return value ? <Box component="span" sx={MONO_SX}>{value}</Box> : undefined;
}

function streamTone(status: string): FabricTone {
  if (status === "live") return "good";
  return status === "down" ? "bad" : "warn";
}

function NodeFacts({ node }: { node: FabricTopologyNode }): React.JSX.Element {
  const { status } = useFabric();
  const stream = status?.nodes.find((item) => item.name === node.name);
  const labels = Object.entries(stream?.labels ?? {}).map(([key, value]) => `${key}=${value}`).join(" ");
  return (
    <FieldList
      fields={[
        ["Tier", node.tier],
        ["Stream", stream ? <Pill key="stream" dot tone={streamTone(stream.status)}>{stream.status}</Pill> : "—"],
        ["Why", node.unreachable],
        ["Since", ago(stream?.since)],
        ["System", mono(node.ipv4)],
        ["System v6", mono(node.ipv6)],
        ["AS", node.asn === null || node.asn === undefined ? undefined : String(node.asn)],
        ["Labels", labels]
      ]}
    />
  );
}

function NodePlatform({ name }: { name: string }): React.JSX.Element {
  const { client, at } = useFabric();
  const platform = useFabricAnswer<FabricTableAnswer>(client, {
    method: "GET",
    path: "reports/sys-info",
    query: { node: name, at: at === undefined ? undefined : String(at) }
  });
  const record = platform.answer?.records?.[0];
  const lastSeen = textOf(record, "last_seen");
  return (
    <>
      <SectionTitle>Platform{lastSeen ? `, as last read ${lastSeen}` : ""}</SectionTitle>
      {platform.error ? <ErrorNote>{platform.error}</ErrorNote> : null}
      {!platform.answer && platform.loading ? <LoadingNote label="Reading…" /> : null}
      {record ? (
        <FieldList
          fields={[
            ["Type", textOf(record, "type")],
            ["Software", textOf(record, "software_version")],
            ["Serial", textOf(record, "serial_number")],
            ["Part", textOf(record, "part_number")],
            ["Base MAC", mono(textOf(record, "hw_mac_address"))],
            ["Last booted", textOf(record, "last_booted")],
            ["Mgmt", mono(textOf(record, "address"))]
          ]}
        />
      ) : null}
      {platform.answer && !record ? <Typography variant="body2" sx={{ color: "text.secondary" }}>Not read yet.</Typography> : null}
    </>
  );
}

function NodeCables({ name, links }: { name: string; links: readonly FabricLink[] }): React.JSX.Element | null {
  const { go } = useFabric();
  if (links.length === 0) return null;
  return (
    <>
      <SectionTitle>Cables</SectionTitle>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, fontSize: 12 }}>
        {links.flatMap((link) => link.cables.map((cable) => {
          const [port, peer, peerPort] = link.a === name ? [cable.a_port, link.b, cable.b_port] : [cable.b_port, link.a, cable.a_port];
          return (
            <Box key={`${linkId(link)}|${cable.a_port}`} sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
              <Pill dot tone={CABLE_TONES[cable.state] ?? "neutral"}>{cable.state}</Pill>
              <Box component="span" sx={MONO_SX}>{port}</Box>
              <span>→</span>
              <TextLink onClick={() => go(nodeRoute(peer))}>{peer}</TextLink>
              <Box component="span" sx={MONO_SX}>{peerPort}</Box>
            </Box>
          );
        }))}
      </Box>
    </>
  );
}

function NodeDetails({ node, topology }: { node: FabricTopologyNode; topology: FabricTopology }): React.JSX.Element {
  const { go } = useFabric();
  const findings = useFindings([node.name]);
  const links = topology.links.filter((link) => link.a === node.name || link.b === node.name);
  const clients = topology.clients.filter((item) => item.nodes.includes(node.name));
  return (
    <>
      <NodeFacts node={node} />
      <NodePlatform name={node.name} />
      <SectionTitle>Findings</SectionTitle>
      {findings.error ? <ErrorNote>{findings.error}</ErrorNote> : null}
      {findings.answer ? <FindingsList findings={findings.answer} /> : null}
      <NodeCables name={node.name} links={links} />
      {clients.length > 0 ? (
        <>
          <SectionTitle>Clients</SectionTitle>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, fontSize: 12 }}>
            {clients.map((item) => (
              <TextLink key={item.id} onClick={() => go({ view: "topology", query: { client: item.id, clients: "1" } })}>{item.label}</TextLink>
            ))}
          </Box>
        </>
      ) : null}
    </>
  );
}

function LinkDetails({ link }: { link: FabricLink }): React.JSX.Element {
  const { go } = useFabric();
  const findings = useFindings([link.a, link.b]);
  const ports = useMemo(() => new Map([
    [link.a, link.cables.map((cable) => cable.a_port)],
    [link.b, link.cables.map((cable) => cable.b_port)]
  ]), [link]);
  const onPorts = (findings.answer ?? []).filter((finding) =>
    (ports.get(finding.node) ?? []).some((port) => finding.subject === port || finding.subject.startsWith(`${port}.`))
  );
  return (
    <>
      {link.cables.map((cable) => (
        <Box key={cable.a_port} sx={{ fontSize: 12, mb: 1.25 }} data-testid="fabric-details-cable">
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 0.5 }}>
            <Pill dot tone={CABLE_TONES[cable.state] ?? "neutral"}>{cable.state}</Pill>
          </Box>
          <FieldList
            fields={[
              [link.a, mono(cable.a_port)],
              [link.b, mono(cable.b_port)],
              [`${link.a} sends`, formatBps(cable.a_out_bps)],
              [`${link.b} sends`, formatBps(cable.b_out_bps)]
            ]}
          />
          {cable.state === "lost" ? (
            <Typography variant="caption" component="p" sx={{ color: "text.secondary", mt: 0.5 }}>
              The history saw this cable, but LLDP no longer reports it.
            </Typography>
          ) : null}
        </Box>
      ))}
      <SectionTitle>Findings on these ports</SectionTitle>
      {findings.error ? <ErrorNote>{findings.error}</ErrorNote> : null}
      {findings.answer ? <FindingsList findings={onPorts} /> : null}
      <SectionTitle>Ends</SectionTitle>
      <Box sx={{ display: "flex", gap: 1, fontSize: 12 }}>
        <TextLink onClick={() => go(nodeRoute(link.a))}>{link.a}</TextLink>
        <TextLink onClick={() => go(nodeRoute(link.b))}>{link.b}</TextLink>
      </Box>
    </>
  );
}

function ClientDetails({ item, topology }: { item: FabricAttachedClient; topology: FabricTopology }): React.JSX.Element {
  const { go } = useFabric();
  const segment = item.esi ? topology.segments.find((candidate) => candidate.esi === item.esi) : undefined;
  return (
    <>
      <FieldList
        fields={[
          ["LLDP name", item.name],
          ["Segment", segment ? segment.names.join(", ") || segment.esi : undefined],
          ["Mode", segment?.mode],
          ["ESI", mono(item.esi)]
        ]}
      />
      <SectionTitle>Attachments</SectionTitle>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        {item.attachments.map((attachment) => (
          <FieldList
            key={`${attachment.node}|${attachment.subinterface}`}
            fields={[
              ["Node", <TextLink key="node" onClick={() => go(nodeRoute(attachment.node))}>{attachment.node}</TextLink>],
              ["Port", mono(attachment.subinterface)],
              ["Service", attachment.service],
              ["VLAN", attachment.vlan === null || attachment.vlan === undefined ? undefined : String(attachment.vlan)],
              ["Addresses", (attachment.addresses ?? []).join(", ")],
              ["To it", formatBps(attachment.out_bps)],
              ["From it", formatBps(attachment.in_bps)]
            ]}
          />
        ))}
      </Box>
    </>
  );
}

function selectionTitle(selection: FabricSelection, topology: FabricTopology): string {
  if (selection.type === "client") return topology.clients.find((item) => item.id === selection.id)?.label ?? selection.id;
  return selection.type === "link" ? selection.id.split("|").join(" ⇄ ") : selection.id;
}

export function FabricTopologyDetails({ selection, topology, onClose }: {
  selection: FabricSelection;
  topology: FabricTopology;
  onClose: () => void;
}): React.JSX.Element {
  const node = selection.type === "node" ? topology.nodes.find((item) => item.name === selection.id) : undefined;
  const link = selection.type === "link" ? topology.links.find((item) => linkId(item) === selection.id) : undefined;
  const client = selection.type === "client" ? topology.clients.find((item) => item.id === selection.id) : undefined;
  return (
    <Box
      component="aside"
      data-testid="fabric-topology-details"
      aria-label="Details"
      sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, bgcolor: "background.paper" }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, pl: 1.5, pr: 0.5, py: 0.5, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
        <Typography component="h2" variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>{selectionTitle(selection, topology)}</Typography>
        <IconButton size="small" aria-label="Close details" data-testid="fabric-details-close" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1.5 }}>
        {node ? <NodeDetails key={node.name} node={node} topology={topology} /> : null}
        {link ? <LinkDetails key={linkId(link)} link={link} /> : null}
        {client ? <ClientDetails key={client.id} item={client} topology={topology} /> : null}
        {!node && !link && !client ? (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>It is no longer part of the fabric.</Typography>
        ) : null}
      </Box>
    </Box>
  );
}
