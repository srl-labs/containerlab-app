// Stages tab for node editor: wait-for dependencies and per-stage exec commands.
import React, { useMemo, useRef } from "react";
import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";

import { FilterableDropdown, InputField, PanelSectionHeader, SelectField } from "../../ui/form";
import { DeleteItemButton } from "../../ui/form/ListButtons";
import { createRowIds, nextRowId } from "../../ui/form/listRowIds";
import { useGraphStore } from "../../../stores/graphStore";
import {
  STAGE_EXEC_TARGET_HOST,
  STAGE_NAMES,
  findWaitForCycle,
  getNodeWaitForDependencies,
  listWaitForDependencies,
  resolveEffectiveStages
} from "../../../core/utilities/nodeStages";
import type {
  InheritedStages,
  NodeStages,
  StageConfig,
  StageExec,
  StageName,
  StageWaitFor,
  WaitForDependency
} from "../../../core/utilities/nodeStages";

import type { TabProps } from "./types";
import { withCurrentOption } from "./selectOptions";

const STAGE_INFO: Record<StageName, { title: string; description: string }> = {
  create: {
    title: "Create",
    description: "The container is created."
  },
  "create-links": {
    title: "Create links",
    description: "Links are attached to the node."
  },
  configure: {
    title: "Configure",
    description: "Post-deploy configuration runs."
  },
  healthy: {
    title: "Healthy",
    description: "The node passes its healthcheck."
  },
  exit: {
    title: "Exit",
    description: "The container has exited."
  }
};

const STAGE_OPTIONS = STAGE_NAMES.map((name) => ({ value: name, label: name }));

const PHASE_OPTIONS = [
  { value: "on-enter", label: "On enter" },
  { value: "on-exit", label: "On exit" }
];

const TARGET_OPTIONS = [
  { value: "container", label: "Container" },
  { value: STAGE_EXEC_TARGET_HOST, label: "Host" }
];

const LEVEL_LABELS: Record<string, string> = {
  defaults: "defaults",
  kind: "kind",
  group: "group"
};

const SECTION_BODY_SX = { px: 2, pt: 1, pb: 0.5, display: "flex", flexDirection: "column", gap: 1.5 };
const ROW_SX = { display: "flex", alignItems: "flex-start", gap: 1 } as const;
const HEADER_BUTTON_SX = { minHeight: 24, py: 0, px: 0.75, minWidth: 0 } as const;

/** Stable row keys for a list whose items arrive as plain values */
function useRowKeys(length: number): {
  keys: number[];
  add: () => void;
  remove: (index: number) => void;
} {
  const ref = useRef<number[] | null>(null);
  if (ref.current === null || ref.current.length !== length) ref.current = createRowIds(length);
  const keys = ref.current;
  return {
    keys,
    add: () => {
      ref.current = [...keys, nextRowId()];
    },
    remove: (index) => {
      ref.current = keys.filter((_, i) => i !== index);
    }
  };
}

function withStage(stages: NodeStages | undefined, name: StageName, stage: StageConfig): NodeStages {
  const next: NodeStages = { ...stages, [name]: stage };
  if ((stage.waitFor ?? []).length === 0 && (stage.exec ?? []).length === 0) delete next[name];
  return next;
}

/** Topology nodes this node can wait for, and the wait-for edges of all other nodes */
function useTopologyWaitFor(nodeId: string): {
  nodeNames: string[];
  otherDependencies: WaitForDependency[];
} {
  const nodes = useGraphStore((state) => state.nodes);
  return useMemo(() => {
    const topologyNodes = nodes.filter((node) => node.type === "topology-node");
    const otherDependencies = topologyNodes
      .filter((node) => node.id !== nodeId)
      .flatMap((node) => {
        const data = node.data as { extraData?: Record<string, unknown> } | undefined;
        return getNodeWaitForDependencies(node.id, data?.extraData);
      });
    return {
      nodeNames: topologyNodes.map((node) => node.id).sort((a, b) => a.localeCompare(b)),
      otherDependencies
    };
  }, [nodes, nodeId]);
}

/** Problem with one wait-for entry, as containerlab would report it */
function describeWaitForProblem(
  entry: StageWaitFor,
  nodeId: string,
  nodeNames: Set<string>,
  cycleNodes: Set<string>
): string | undefined {
  const target = entry.node.trim();
  if (target === "") return "Pick a node";
  if (target === nodeId) return "A node cannot wait for itself";
  if (!nodeNames.has(target)) return `There is no node named ${target}`;
  if (entry.stage === "") return "Pick the stage to wait for";
  if (cycleNodes.has(target)) return "Nodes wait for each other in a loop";
  return undefined;
}

interface WaitForRowProps {
  id: string;
  entry: StageWaitFor;
  nodeOptions: Array<{ value: string; label: string }>;
  problem: string | undefined;
  onChange: (entry: StageWaitFor) => void;
  onRemove: () => void;
}

const WaitForRow: React.FC<WaitForRowProps> = ({
  id,
  entry,
  nodeOptions,
  problem,
  onChange,
  onRemove
}) => (
  <Box sx={ROW_SX} data-testid="stage-wait-for-row">
    <Box sx={{ flex: 3, minWidth: 0 }}>
      <FilterableDropdown
        id={`${id}-node`}
        label="Wait for node"
        value={entry.node}
        onChange={(node) => onChange({ ...entry, node })}
        options={nodeOptions}
        placeholder="Node name"
        allowFreeText
        error={problem !== undefined}
        helperText={problem}
      />
    </Box>
    <Box sx={{ flex: 2, minWidth: 0 }}>
      <SelectField
        id={`${id}-stage`}
        label="Until stage done"
        value={entry.stage}
        onChange={(stage) => onChange({ ...entry, stage })}
        options={withCurrentOption(STAGE_OPTIONS, entry.stage)}
      />
    </Box>
    <Box sx={{ pt: 0.5 }}>
      <DeleteItemButton onRemove={onRemove} />
    </Box>
  </Box>
);

interface ExecRowProps {
  id: string;
  entry: StageExec;
  onChange: (entry: StageExec) => void;
  onRemove: () => void;
}

const ExecRow: React.FC<ExecRowProps> = ({ id, entry, onChange, onRemove }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }} data-testid="stage-exec-row">
    <Box sx={ROW_SX}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <InputField
          id={`${id}-command`}
          label="Command"
          value={entry.command}
          onChange={(command) => onChange({ ...entry, command })}
          placeholder="e.g., ip link show"
          magicVariables
        />
      </Box>
      <Box sx={{ pt: 0.5 }}>
        <DeleteItemButton onRemove={onRemove} />
      </Box>
    </Box>
    <Box sx={{ ...ROW_SX, pr: 4.5 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <SelectField
          id={`${id}-phase`}
          label="Run"
          value={entry.phase ?? "on-enter"}
          onChange={(phase) => onChange({ ...entry, phase })}
          options={withCurrentOption(PHASE_OPTIONS, entry.phase ?? "on-enter")}
        />
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <SelectField
          id={`${id}-target`}
          label="Run in"
          value={entry.target ?? "container"}
          onChange={(target) =>
            // Container is the default, so it is only written when the file already had it
            onChange({
              ...entry,
              target: target === STAGE_EXEC_TARGET_HOST ? target : undefined
            })
          }
          options={withCurrentOption(TARGET_OPTIONS, entry.target ?? "container")}
        />
      </Box>
    </Box>
  </Box>
);

interface InheritedEntry {
  level: string;
  text: string;
}

function listInheritedEntries(inherited: InheritedStages[], name: StageName): InheritedEntry[] {
  const result: InheritedEntry[] = [];
  for (const { level, stages } of inherited) {
    for (const entry of stages[name]?.waitFor ?? []) {
      result.push({ level, text: `Waits for ${entry.node} (${entry.stage || "no stage"})` });
    }
    for (const entry of stages[name]?.exec ?? []) {
      const where = entry.target === STAGE_EXEC_TARGET_HOST ? " on host" : "";
      result.push({ level, text: `${entry.phase ?? "on-enter"}${where}: ${entry.command}` });
    }
  }
  return result;
}

const InheritedEntries: React.FC<{ entries: InheritedEntry[] }> = ({ entries }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
    {entries.map((entry, index) => (
      <Box
        key={index}
        sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}
        data-testid="stage-inherited-entry"
      >
        <Chip label={`from ${LEVEL_LABELS[entry.level] ?? entry.level}`} size="small" />
        <Typography
          variant="body2"
          sx={{ color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis" }}
          noWrap
          title={entry.text}
        >
          {entry.text}
        </Typography>
      </Box>
    ))}
  </Box>
);

interface StageSectionProps {
  name: StageName;
  nodeId: string;
  stage: StageConfig;
  inherited: InheritedEntry[];
  nodeOptions: Array<{ value: string; label: string }>;
  nodeNames: Set<string>;
  cycleNodes: Set<string>;
  onChange: (stage: StageConfig) => void;
}

const StageSection: React.FC<StageSectionProps> = ({
  name,
  nodeId,
  stage,
  inherited,
  nodeOptions,
  nodeNames,
  cycleNodes,
  onChange
}) => {
  const waitFor = stage.waitFor ?? [];
  const exec = stage.exec ?? [];
  const waitForKeys = useRowKeys(waitFor.length);
  const execKeys = useRowKeys(exec.length);
  const info = STAGE_INFO[name];

  const addWaitFor = () => {
    waitForKeys.add();
    onChange({ ...stage, waitFor: [...waitFor, { node: "", stage: "create" }] });
  };
  const addExec = () => {
    execKeys.add();
    onChange({ ...stage, exec: [...exec, { command: "", phase: "on-enter" }] });
  };

  return (
    <Box data-testid={`stage-section-${name}`}>
      <PanelSectionHeader
        title={info.title}
        action={
          <Box sx={{ display: "flex", gap: 0.5, mr: -1 }}>
            <Button
              variant="text"
              size="small"
              startIcon={<AddIcon />}
              onClick={addWaitFor}
              sx={HEADER_BUTTON_SX}
              data-testid={`stage-add-wait-for-${name}`}
            >
              Wait for
            </Button>
            <Button
              variant="text"
              size="small"
              startIcon={<AddIcon />}
              onClick={addExec}
              sx={HEADER_BUTTON_SX}
              data-testid={`stage-add-exec-${name}`}
            >
              Command
            </Button>
          </Box>
        }
      />
      <Box sx={SECTION_BODY_SX}>
        <Typography variant="caption" sx={{ color: "text.secondary", mt: -0.5 }}>
          {info.description}
        </Typography>
        {inherited.length > 0 && <InheritedEntries entries={inherited} />}
        {waitFor.map((entry, index) => (
          <WaitForRow
            key={waitForKeys.keys[index]}
            id={`node-stage-${name}-wait-for-${index}`}
            entry={entry}
            nodeOptions={nodeOptions}
            problem={describeWaitForProblem(entry, nodeId, nodeNames, cycleNodes)}
            onChange={(next) =>
              onChange({ ...stage, waitFor: waitFor.map((e, i) => (i === index ? next : e)) })
            }
            onRemove={() => {
              waitForKeys.remove(index);
              onChange({ ...stage, waitFor: waitFor.filter((_, i) => i !== index) });
            }}
          />
        ))}
        {exec.map((entry, index) => (
          <ExecRow
            key={execKeys.keys[index]}
            id={`node-stage-${name}-exec-${index}`}
            entry={entry}
            onChange={(next) =>
              onChange({ ...stage, exec: exec.map((e, i) => (i === index ? next : e)) })
            }
            onRemove={() => {
              execKeys.remove(index);
              onChange({ ...stage, exec: exec.filter((_, i) => i !== index) });
            }}
          />
        ))}
      </Box>
    </Box>
  );
};

export const StagesTab: React.FC<TabProps> = ({ data, onChange }) => {
  const inherited = useMemo(() => data.inheritedStages ?? [], [data.inheritedStages]);
  const { nodeNames, otherDependencies } = useTopologyWaitFor(data.id);

  const nodeOptions = useMemo(
    () =>
      nodeNames
        .filter((name) => name !== data.id)
        .map((name) => ({ value: name, label: name })),
    [nodeNames, data.id]
  );
  const nodeNameSet = useMemo(() => new Set(nodeNames), [nodeNames]);

  const cycle = useMemo(() => {
    const own = listWaitForDependencies(data.id, resolveEffectiveStages(data.stages, inherited));
    const found = findWaitForCycle([...otherDependencies, ...own], data.id);
    return found?.includes(data.id) === true ? found : null;
  }, [data.id, data.stages, inherited, otherDependencies]);
  const cycleNodes = useMemo(() => new Set(cycle ?? []), [cycle]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", pb: 1 }}>
      <Typography variant="body2" sx={{ color: "text.secondary", px: 2, pt: 2 }}>
        Wait for stages of other nodes, and run commands when the node enters or leaves a stage.
      </Typography>
      {cycle && (
        <Typography
          variant="body2"
          sx={{ color: "error.main", px: 2, pt: 1 }}
          data-testid="stage-cycle-error"
        >
          {`Nodes wait for each other in a loop (${cycle.join(" → ")}). containerlab will not deploy the lab.`}
        </Typography>
      )}
      {STAGE_NAMES.map((name) => (
        <StageSection
          key={name}
          name={name}
          nodeId={data.id}
          stage={data.stages?.[name] ?? {}}
          inherited={listInheritedEntries(inherited, name)}
          nodeOptions={nodeOptions}
          nodeNames={nodeNameSet}
          cycleNodes={cycleNodes}
          onChange={(stage) => onChange({ stages: withStage(data.stages, name, stage) })}
        />
      ))}
    </Box>
  );
};
