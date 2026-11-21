/* eslint-disable import-x/max-dependencies */
// The lab guide beside the topology: one step at a time, with blocks that run on the lab's nodes.
import React from "react";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import type { TopologyGuideFile } from "../../../core/types/messages";
import { useClabUiHost, type ClabUiTopoViewerHost } from "../../../host";
import { guideCodeBlocks, parseGuide, type GuideCodeBlock, type GuidePart } from "../../../guide/parseGuide";
import {
  guideProgressKey,
  readGuideProgress,
  writeGuideProgress,
  type GuideProgress
} from "../../../guide/guideProgress";
import { useDeploymentCommands } from "../../../hooks/ui/usePanelCommands";
import {
  needsConfirmation,
  resolveScriptButtonConfirm,
  trustScript,
  type ScriptButtonConfirm
} from "../../../scriptButtons/scriptButtonPolicy";
import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { useTopologyNodeNames } from "../lab-operations/LabOperationParts";

import { GuideBlock, type GuideBlockAction, type GuideBlockRun } from "./GuideBlock";
import { GuideMarkdown } from "./GuideMarkdown";

const IDLE: GuideBlockRun = { status: "idle" };

/** Whether this host can run the block at all; the others can only be copied. */
function hostRuns(block: GuideCodeBlock, topoViewer: ClabUiTopoViewerHost): boolean {
  if (block.kind === "exec") return topoViewer.labOperations !== undefined;
  if (block.kind === "terminal") return topoViewer.sendNodeTerminalInput !== undefined;
  return false;
}

/** Why the block cannot run now, if it can't. */
function blockAction(block: GuideCodeBlock, deployed: boolean, nodeNames: ReadonlySet<string>): GuideBlockAction {
  if (block.kind === "exec" && block.command === undefined) {
    return { disabledReason: "An exec block runs one command. Use terminal= for several." };
  }
  const missing = block.nodes.find((node) => !nodeNames.has(node));
  if (missing !== undefined) return { disabledReason: `This lab has no node named ${missing}.` };
  if (!deployed) return { disabledReason: "Deploy the lab first." };
  return {};
}

/**
 * The key the reader's agreement to a block is kept under: the SHA-256 of what
 * it runs where, so no edited block can pass for one they agreed to. Without
 * Web Crypto, as on a page served over plain HTTP, there is none, and the
 * block asks before every run.
 */
async function trustKeyFor(guideKey: string, block: GuideCodeBlock): Promise<string | undefined> {
  // Web Crypto's digest only exists in a secure context, whatever the DOM types say.
  if (!globalThis.isSecureContext) return undefined;
  const text = `${block.kind}\n${block.nodes.join(",")}\n${block.code}`;
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
    return `guide:${guideKey}:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return undefined;
  }
}

/**
 * When blocks ask before they run: the script buttons' setting, except that a
 * guide is usually someone else's, so "only scripts from others" still asks
 * the first time for each block.
 */
function guideConfirmMode(): ScriptButtonConfirm {
  const mode = resolveScriptButtonConfirm();
  return mode === "never" ? "firstRun" : mode;
}

/** The reader's place in the guide, saved in this browser as it changes. */
function useGuideProgress(key: string): [GuideProgress, React.Dispatch<React.SetStateAction<GuideProgress>>] {
  const [progress, setProgress] = React.useState(() => readGuideProgress(key));
  React.useEffect(() => writeGuideProgress(key, progress), [key, progress]);
  return [progress, setProgress];
}

const DeployBanner: React.FC = () => {
  const isProcessing = useTopoViewerStore((state) => state.isProcessing);
  const setProcessing = useTopoViewerStore((state) => state.setProcessing);
  const { onDeploy } = useDeploymentCommands();
  const handleDeploy = React.useCallback(() => {
    setProcessing(true, "deploy");
    onDeploy();
  }, [onDeploy, setProcessing]);
  return (
    <Alert
      severity="info"
      variant="outlined"
      icon={<RocketLaunchOutlinedIcon fontSize="small" />}
      data-testid="guide-deploy-banner"
      action={
        <Button size="small" onClick={handleDeploy} disabled={isProcessing} data-testid="guide-deploy">
          Deploy
        </Button>
      }
    >
      Deploy this lab to run the guide&apos;s commands on its nodes.
    </Alert>
  );
};

function segmentColor(isDone: boolean, isCurrent: boolean): string {
  if (isDone) return "success.main";
  if (isCurrent) return "primary.main";
  return "action.selected";
}

/** One segment per step: green once done, blue for the current one. A click goes to that step. */
const StepProgress: React.FC<{
  titles: string[];
  current: number;
  done: (index: number) => boolean;
  onSelect: (index: number) => void;
}> = ({ titles, current, done, onSelect }) => (
  <Box
    component="nav"
    aria-label="Guide steps"
    sx={{ display: "flex", gap: 0.5 }}
    data-testid="guide-steps"
  >
    {titles.map((title, index) => {
      const isDone = done(index);
      const isCurrent = index === current;
      const label = `${index + 1}. ${title}${isDone ? " (done)" : ""}`;
      return (
        <Tooltip key={`${index}-${title}`} title={label}>
          <Box
            component="button"
            type="button"
            aria-label={`${index + 1}. ${title}`}
            aria-current={isCurrent ? "step" : undefined}
            onClick={() => onSelect(index)}
            data-testid="guide-step"
            data-done={isDone}
            sx={{
              flex: 1,
              minWidth: 0,
              // A taller target than the bar it draws.
              py: 0.75,
              px: 0,
              border: 0,
              bgcolor: "transparent",
              cursor: "pointer",
              "&::before": {
                content: '""',
                display: "block",
                height: 4,
                borderRadius: 2,
                bgcolor: segmentColor(isDone, isCurrent),
                transition: "background-color 160ms ease, transform 120ms ease"
              },
              "&:hover::before": { transform: "scaleY(1.5)" },
              "&:focus-visible": { outline: "1px solid var(--vscode-focusBorder)", outlineOffset: 1 },
              "@media (prefers-reduced-motion: reduce)": { "&::before": { transition: "none" } }
            }}
          />
        </Tooltip>
      );
    })}
  </Box>
);

interface PartsProps {
  parts: GuidePart[];
  ticked: ReadonlySet<string>;
  runs: Readonly<Record<string, GuideBlockRun>>;
  actionFor: (block: GuideCodeBlock) => GuideBlockAction | null;
  nodeNames: string[];
  onToggleTick: (id: string) => void;
  onRun: (block: GuideCodeBlock) => void;
  onConfirm: (block: GuideCodeBlock, trustGuide: boolean) => void;
  onCancel: (id: string) => void;
}

const GuideParts: React.FC<PartsProps> = ({ parts, ticked, runs, actionFor, nodeNames, ...handlers }) => (
  <>
    {parts.map((part, index) =>
      part.type === "markdown" ? (
        // Text parts have no id of their own and never move between blocks.
        <GuideMarkdown key={`text-${index}`} text={part.text} />
      ) : (
        <GuideBlock
          key={part.id}
          block={part}
          ticked={ticked.has(part.id)}
          action={actionFor(part)}
          run={runs[part.id] ?? IDLE}
          nodeNames={nodeNames}
          {...handlers}
        />
      )
    )}
  </>
);

/** One guide of one lab: its progress and runs start over for another. */
export const GuideTab: React.FC<{ guide: TopologyGuideFile }> = ({ guide }) => {
  const labName = useTopoViewerStore((state) => state.labName);
  const guideKey = guideProgressKey(labName, guide.fileName);
  return <GuideView key={guideKey} guide={guide} guideKey={guideKey} />;
};

const GuideView: React.FC<{ guide: TopologyGuideFile; guideKey: string }> = ({ guide, guideKey }) => {
  const parsed = React.useMemo(() => parseGuide(guide.content), [guide.content]);
  const deployed = useTopoViewerStore((state) => state.deploymentState === "deployed");
  const { topoViewer } = useClabUiHost();
  const nodeNameList = useTopologyNodeNames();
  const nodeNames = React.useMemo(() => new Set(nodeNameList), [nodeNameList]);
  const [progress, setProgress] = useGuideProgress(guideKey);
  const ticked = React.useMemo(() => new Set(progress.ticked), [progress.ticked]);
  const [runs, setRuns] = React.useState<Record<string, GuideBlockRun>>({});

  const stepCount = parsed.steps.length;
  const step = Math.min(progress.step, Math.max(0, stepCount - 1));
  const blocks = React.useMemo(() => guideCodeBlocks(parsed), [parsed]);
  const tickedCount = blocks.filter((block) => ticked.has(block.id)).length;
  const hasRunnable = blocks.some((block) => hostRuns(block, topoViewer));
  const actionFor = (block: GuideCodeBlock) =>
    hostRuns(block, topoViewer) ? blockAction(block, deployed, nodeNames) : null;

  const setRun = React.useCallback((id: string, run: GuideBlockRun) => {
    setRuns((current) => ({ ...current, [id]: run }));
  }, []);

  /** Ticks the block, unticks it, or toggles it without `on`. */
  const setTicked = React.useCallback(
    (id: string, on?: boolean) => {
      setProgress((current) => {
        const was = current.ticked.includes(id);
        if (was === (on ?? !was)) return current;
        const ticks = was ? current.ticked.filter((entry) => entry !== id) : [...current.ticked, id];
        return { ...current, ticked: ticks };
      });
    },
    [setProgress]
  );

  const execute = React.useCallback(
    (block: GuideCodeBlock) => {
      if (block.kind === "terminal") {
        for (const node of block.nodes) topoViewer.sendNodeTerminalInput?.(node, block.code);
        setRun(block.id, { status: "sent" });
        setTicked(block.id, true);
        return;
      }
      const operations = topoViewer.labOperations;
      if (!operations || block.command === undefined) return;
      setRun(block.id, { status: "running" });
      operations.exec({ command: block.command, nodeNames: block.nodes }).then(
        (result) => {
          setRun(block.id, { status: "done", result });
          // A finished run counts whatever its exit codes: a failing command can be the lesson.
          setTicked(block.id, true);
        },
        (error: unknown) => {
          setRun(block.id, { status: "error", message: error instanceof Error ? error.message : String(error) });
        }
      );
    },
    [setRun, setTicked, topoViewer]
  );

  const handleRun = React.useCallback(
    (block: GuideCodeBlock) => {
      void trustKeyFor(guideKey, block).then((trustKey) => {
        const mode = guideConfirmMode();
        if (trustKey === undefined || needsConfirmation(mode, { foreign: false, trustKey })) {
          // Remembering needs the fingerprint, and "every run" asks whatever was agreed to.
          setRun(block.id, { status: "confirm", canTrustGuide: trustKey !== undefined && mode === "firstRun" });
          return;
        }
        execute(block);
      });
    },
    [execute, guideKey, setRun]
  );

  /** Runs the block; agreed to for the whole guide, every block as it is now runs without asking. */
  const handleConfirm = React.useCallback(
    (block: GuideCodeBlock, trustGuide: boolean) => {
      execute(block);
      const agreed = trustGuide ? blocks.filter((entry) => entry.kind !== "copy") : [block];
      void Promise.all(agreed.map((entry) => trustKeyFor(guideKey, entry))).then((trustKeys) => {
        for (const trustKey of trustKeys) if (trustKey !== undefined) trustScript(trustKey);
      });
    },
    [blocks, execute, guideKey]
  );

  const handleCancel = React.useCallback((id: string) => setRun(id, IDLE), [setRun]);

  const stepDone = React.useCallback(
    (index: number) => {
      const stepBlocks = parsed.steps[index]?.parts.filter((part) => part.type === "code") ?? [];
      // A step without blocks is done once the reader has moved past it.
      return stepBlocks.length > 0 ? stepBlocks.every((block) => ticked.has(block.id)) : index < step;
    },
    [parsed.steps, step, ticked]
  );

  const goTo = React.useCallback(
    (index: number) => setProgress((current) => ({ ...current, step: index })),
    [setProgress]
  );

  const partsProps = {
    ticked,
    runs,
    actionFor,
    nodeNames: nodeNameList,
    onToggleTick: setTicked,
    onRun: handleRun,
    onConfirm: handleConfirm,
    onCancel: handleCancel
  };
  const current = parsed.steps.at(step);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid="guide-tab">
      <Box sx={{ px: 2, pt: 1.5, pb: 1.25, display: "flex", flexDirection: "column", gap: 1, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>
          <Typography variant="subtitle2" component="h2" sx={{ fontSize: 14, minWidth: 0 }} data-testid="guide-title">
            {parsed.title ?? guide.fileName}
          </Typography>
          {parsed.duration !== undefined && (
            <Typography variant="caption" sx={{ color: "text.secondary", flex: "none" }}>
              {parsed.duration}
            </Typography>
          )}
        </Box>
        {current && (
          <>
            <StepProgress
              titles={parsed.steps.map((entry) => entry.title)}
              current={step}
              done={stepDone}
              onSelect={goTo}
            />
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}
                data-testid="guide-step-count"
              >
                Step {step + 1} of {stepCount}
                {stepDone(step) ? " · done" : ""}
              </Typography>
              <Typography variant="subtitle1" component="h3" sx={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }} data-testid="guide-step-title">
                {current.title}
              </Typography>
            </Box>
          </>
        )}
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          px: 2,
          py: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
          // Blocks keep their height and the body scrolls; shrunk, they would clip their output.
          "& > *": { flexShrink: 0 }
        }}
        data-testid="guide-body"
      >
        {hasRunnable && !deployed && <DeployBanner />}
        {(step === 0 || stepCount === 0) && <GuideParts parts={parsed.intro} {...partsProps} />}
        {current && <GuideParts parts={current.parts} {...partsProps} />}
      </Box>
      {stepCount > 0 && (
        <Box
          sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, px: 2, py: 1, borderTop: 1, borderColor: "divider" }}
        >
          <Button size="small" onClick={() => goTo(step - 1)} disabled={step === 0} data-testid="guide-back">
            Back
          </Button>
          <Typography variant="caption" sx={{ color: "text.secondary" }} data-testid="guide-progress">
            {blocks.length > 0 && `${tickedCount} of ${blocks.length} blocks done`}
          </Typography>
          <Button
            size="small"
            variant="contained"
            disableElevation
            onClick={() => goTo(step + 1)}
            disabled={step >= stepCount - 1}
            data-testid="guide-next"
          >
            Next step
          </Button>
        </Box>
      )}
    </Box>
  );
};
