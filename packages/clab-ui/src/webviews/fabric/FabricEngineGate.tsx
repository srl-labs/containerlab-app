/** Everything before the fabric can be shown: starting the engine, and what to do when it is not running. */
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import HubOutlinedIcon from "@mui/icons-material/HubOutlined";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import React, { useCallback, useEffect, useRef, useState } from "react";

import type { FabricClient, FclingEngineStatus } from "../../fabric/engine";
import { controlRadius, floatingRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";

import { errorMessage } from "./fabricData";

const POLL_STARTING_MS = 1_500;
const POLL_READY_MS = 10_000;
const MAX_POLL_FAILURES = 5;

type EnginePhase =
  | { phase: "checking" }
  /** Asked to start: it answers once it runs, which a first image pull makes take a while. */
  | { phase: "starting" }
  /** It runs, and is connecting to the nodes. */
  | { phase: "connecting" }
  | { phase: "ready" }
  | { phase: "stopped"; byUser: boolean }
  | { phase: "failed"; error: string };

function phaseOf(status: FclingEngineStatus): EnginePhase {
  switch (status.state) {
    case "ready":
      return { phase: "ready" };
    case "starting":
      return { phase: "connecting" };
    case "failed":
      return { phase: "failed", error: status.error || "The engine stopped without saying why." };
    default:
      return { phase: "stopped", byUser: false };
  }
}

/** The engine's state: started once on opening, followed from then on. */
function useEngine(client: FabricClient): {
  engine: EnginePhase;
  start: () => void;
  stop: () => void;
  check: () => void;
} {
  const [engine, setEngine] = useState<EnginePhase>({ phase: "checking" });
  const autoStarted = useRef(false);
  const alive = useRef(true);

  const start = useCallback(() => {
    setEngine({ phase: "starting" });
    client.startEngine().then(
      (status) => {
        if (alive.current) setEngine(status.state === "stopped" ? { phase: "connecting" } : phaseOf(status));
      },
      (error: unknown) => {
        if (alive.current) setEngine({ phase: "failed", error: errorMessage(error) });
      }
    );
  }, [client]);

  useEffect(() => {
    alive.current = true;
    client.engineStatus().then(
      (status) => {
        if (!alive.current) return;
        if (status.state === "stopped" && !autoStarted.current) {
          autoStarted.current = true;
          start();
        } else {
          setEngine(phaseOf(status));
        }
      },
      (error: unknown) => {
        if (alive.current) setEngine({ phase: "failed", error: errorMessage(error) });
      }
    );
    return () => {
      alive.current = false;
    };
  }, [client, start]);

  const check = useCallback(() => {
    client.engineStatus().then(
      (status) => {
        if (!alive.current) return;
        // A stream that ended while the engine still runs comes back by itself.
        setEngine((current) => {
          const next = phaseOf(status);
          return current.phase === next.phase ? current : next;
        });
      },
      () => {
        // The host may be away for a moment; the next look tells.
      }
    );
  }, [client]);

  const { phase } = engine;
  useEffect(() => {
    if (phase !== "connecting" && phase !== "ready") return undefined;
    let failures = 0;
    const timer = setInterval(() => {
      client.engineStatus().then(
        (status) => {
          failures = 0;
          if (alive.current) setEngine((current) => (current.phase === phaseOf(status).phase ? current : phaseOf(status)));
        },
        (error: unknown) => {
          failures += 1;
          // While it runs, the view has its own word on a host that went away.
          if (alive.current && phase === "connecting" && failures >= MAX_POLL_FAILURES) {
            setEngine({ phase: "failed", error: errorMessage(error) });
          }
        }
      );
    }, phase === "ready" ? POLL_READY_MS : POLL_STARTING_MS);
    return () => clearInterval(timer);
  }, [client, phase]);

  const stop = useCallback(() => {
    client.stopEngine().then(
      () => {
        if (alive.current) setEngine({ phase: "stopped", byUser: true });
      },
      (error: unknown) => {
        if (alive.current) setEngine({ phase: "failed", error: errorMessage(error) });
      }
    );
  }, [client]);

  return { engine, start, stop, check };
}

function GateCard({ icon, title, children, progress = false, testId }: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  progress?: boolean;
  testId: string;
}): React.JSX.Element {
  return (
    <Box
      data-testid={testId}
      sx={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", p: 2, overflow: "auto" }}
    >
      <Box
        sx={{
          width: "100%", maxWidth: 480, p: 3, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.25,
          textAlign: "center", border: 1, borderColor: "divider", borderRadius: floatingRadius, bgcolor: "background.paper"
        }}
      >
        <Box sx={{ color: "text.secondary", display: "flex", "& svg": { fontSize: 36 } }}>{icon}</Box>
        <Typography component="h1" variant="subtitle1">{title}</Typography>
        {children}
        {progress ? <LinearProgress sx={{ width: "100%", mt: 0.5, borderRadius: 1 }} /> : null}
      </Box>
    </Box>
  );
}

function GateText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Typography variant="body2" sx={{ color: "text.secondary" }}>{children}</Typography>;
}

/** Shows `children` while the engine answers; what it takes to get there until then. */
export function FabricEngineGate({ client, labName, children }: {
  client: FabricClient;
  labName: string;
  children: (engine: { stop: () => void; check: () => void }) => React.ReactNode;
}): React.JSX.Element {
  const { engine, start, stop, check } = useEngine(client);
  switch (engine.phase) {
    case "ready":
      return <>{children({ stop, check })}</>;
    case "checking":
      return (
        <GateCard testId="fabric-engine-checking" icon={<HubOutlinedIcon />} title="Looking for the fabric engine" progress>
          <GateText>Checking whether it already runs for {labName}.</GateText>
        </GateCard>
      );
    case "starting":
      return (
        <GateCard testId="fabric-engine-starting" icon={<HubOutlinedIcon />} title="Starting the fabric engine" progress>
          <GateText>
            It runs next to {labName} and streams what its SR Linux nodes report. The first start downloads
            its image, which can take a minute.
          </GateText>
        </GateCard>
      );
    case "connecting":
      return (
        <GateCard testId="fabric-engine-connecting" icon={<HubOutlinedIcon />} title="Connecting to the nodes" progress>
          <GateText>The engine is up and subscribing to every SR Linux node of {labName}.</GateText>
        </GateCard>
      );
    case "stopped":
      return (
        <GateCard
          testId="fabric-engine-stopped"
          icon={<PowerSettingsNewIcon />}
          title={engine.byUser ? "The fabric engine is stopped" : "The fabric engine is not running"}
        >
          <GateText>
            {engine.byUser
              ? "Its history is kept, and it records nothing while stopped."
              : "It stops when the lab is destroyed or deployed again. Start it to follow the fabric again."}
          </GateText>
          <Button variant="contained" sx={{ mt: 0.5 }} data-testid="fabric-engine-start" onClick={start}>Start engine</Button>
        </GateCard>
      );
    case "failed":
      return (
        <GateCard testId="fabric-engine-failed" icon={<ErrorOutlineIcon sx={{ color: "error.main" }} />} title="The fabric engine could not start">
          <Box
            component="pre"
            data-testid="fabric-engine-error"
            sx={{
              width: "100%", maxHeight: 220, overflow: "auto", m: 0, p: 1, textAlign: "left", fontSize: 12,
              fontFamily: MONO_FONT_FAMILY, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
              borderRadius: controlRadius, bgcolor: "background.default", border: 1, borderColor: "divider"
            }}
          >
            {engine.error}
          </Box>
          <Button variant="contained" sx={{ mt: 0.5 }} data-testid="fabric-engine-retry" onClick={start}>Retry</Button>
        </GateCard>
      );
  }
}
