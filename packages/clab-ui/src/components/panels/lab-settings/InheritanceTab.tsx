// Lab Settings section for topology defaults, kinds and groups.
import React, { useMemo, useState } from "react";
import Typography from "@mui/material/Typography";

import { SettingsField } from "../../../settings/SettingsField";
import { useTopologySessionClient } from "../../../host";
import { useParsedTopology } from "../../../hooks/editor/useParsedTopology";
import { executeTopologyCommand } from "../../../services/topologyHostCommands";
import type { ClabNode, ClabTopology } from "../../../core/types/topology";
import {
  findKindConfig,
  resolveNodeGroupName,
  resolveNodeKindName
} from "../../../core/parsing/NodeConfigResolver";
import { isRecord } from "../../../core/utilities/typeHelpers";

import {
  InheritanceSectionDialog,
  describeSectionTarget,
  type InheritanceSectionTarget
} from "./InheritanceSectionDialog";
import { AddSection, EmptyList, SectionList, SectionRow } from "./InheritanceSectionList";

interface InheritanceTabProps {
  isViewMode: boolean;
}

type SectionLevel = "kind" | "group";

interface SectionUsage {
  kinds: Map<string, number>;
  groups: Map<string, number>;
}

function sectionsOf(parsed: ClabTopology | null, key: "kinds" | "groups"): Record<string, ClabNode> {
  const value = parsed?.topology?.[key];
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([name, config]) => [name, isRecord(config) ? config : {}])
  );
}

/** How many nodes inherit from each kind and group section. */
function countUsage(parsed: ClabTopology | null): SectionUsage {
  const usage: SectionUsage = { kinds: new Map(), groups: new Map() };
  if (!parsed) return usage;
  const kinds = parsed.topology?.kinds;
  for (const raw of Object.values(parsed.topology?.nodes ?? {})) {
    const node = isRecord(raw) ? raw : {};
    const kind = findKindConfig(kinds, resolveNodeKindName(parsed, node))?.name;
    if (kind !== undefined) usage.kinds.set(kind, (usage.kinds.get(kind) ?? 0) + 1);
    const group = resolveNodeGroupName(parsed, node);
    if (group !== undefined) usage.groups.set(group, (usage.groups.get(group) ?? 0) + 1);
  }
  return usage;
}

export const InheritanceTab: React.FC<InheritanceTabProps> = ({ isViewMode }) => {
  const parsed = useParsedTopology();
  const sessionClient = useTopologySessionClient();
  const [target, setTarget] = useState<InheritanceSectionTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaults = useMemo<ClabNode>(() => {
    const value = parsed?.topology?.defaults;
    return isRecord(value) ? value : {};
  }, [parsed]);
  const kinds = useMemo(() => sectionsOf(parsed, "kinds"), [parsed]);
  const groups = useMemo(() => sectionsOf(parsed, "groups"), [parsed]);
  const usage = useMemo(() => countUsage(parsed), [parsed]);

  const remove = (level: SectionLevel, name: string) => {
    setError(null);
    executeTopologyCommand(
      { command: "setInheritanceSection", payload: { level, name, remove: true } },
      {},
      sessionClient
    ).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  };

  const targetConfig = useMemo<ClabNode>(() => {
    if (!target || target.isNew === true) return {};
    if (target.level === "defaults") return defaults;
    const sections = target.level === "kind" ? kinds : groups;
    return sections[target.name ?? ""] ?? {};
  }, [target, defaults, kinds, groups]);

  return (
    <>
      <SettingsField
        title="Defaults"
        description="Apply to every node unless its kind, group or the node sets them (topology.defaults)."
        wide
      >
        <SectionList testId="lab-inheritance-defaults">
          <SectionRow
            title="Topology defaults"
            config={defaults}
            nodeCount={Object.keys(parsed?.topology?.nodes ?? {}).length}
            isViewMode={isViewMode}
            testId="lab-inheritance-row-defaults"
            onEdit={() => setTarget({ level: "defaults" })}
          />
        </SectionList>
      </SettingsField>

      <SettingsField
        title="Kinds"
        description="Apply to every node of a kind and win over defaults (topology.kinds)."
        wide
      >
        <SectionList testId="lab-inheritance-kinds">
          {Object.keys(kinds).length === 0 ? <EmptyList text="No kind settings" /> : null}
          {Object.entries(kinds).map(([name, config]) => (
            <SectionRow
              key={name}
              title={name}
              config={config}
              nodeCount={usage.kinds.get(name) ?? 0}
              isViewMode={isViewMode}
              testId={`lab-inheritance-row-kind-${name}`}
              onEdit={() => setTarget({ level: "kind", name })}
              onRemove={() => remove("kind", name)}
            />
          ))}
        </SectionList>
        {!isViewMode ? (
          <AddSection
            level="kind"
            existing={Object.keys(kinds)}
            onAdd={(name) => setTarget({ level: "kind", name, isNew: true })}
          />
        ) : null}
      </SettingsField>

      <SettingsField
        title="Groups"
        description="Apply to nodes that name the group and win over kinds and defaults (topology.groups). Not canvas groups."
        wide
      >
        <SectionList testId="lab-inheritance-groups">
          {Object.keys(groups).length === 0 ? <EmptyList text="No groups" /> : null}
          {Object.entries(groups).map(([name, config]) => (
            <SectionRow
              key={name}
              title={name}
              config={config}
              nodeCount={usage.groups.get(name) ?? 0}
              isViewMode={isViewMode}
              testId={`lab-inheritance-row-group-${name}`}
              onEdit={() => setTarget({ level: "group", name })}
              onRemove={() => remove("group", name)}
            />
          ))}
        </SectionList>
        {!isViewMode ? (
          <AddSection
            level="group"
            existing={Object.keys(groups)}
            onAdd={(name) => setTarget({ level: "group", name, isNew: true })}
          />
        ) : null}
      </SettingsField>

      {error !== null ? (
        <Typography variant="body2" sx={{ color: "error.main" }} role="alert">
          {error}
        </Typography>
      ) : null}

      <InheritanceSectionDialog
        key={target ? describeSectionTarget(target) : "closed"}
        target={target}
        config={targetConfig}
        takenNames={Object.keys(groups)}
        readOnly={isViewMode}
        onClose={() => setTarget(null)}
      />
    </>
  );
};
