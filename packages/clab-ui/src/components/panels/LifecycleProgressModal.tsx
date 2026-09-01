/* eslint-disable import-x/max-dependencies */
import React from "react";
import { IconAlertCircle, IconCircleCheck, IconRefresh } from "@tabler/icons-react";
import { Badge, Box, Button, Group, Loader, Modal, Progress, Text } from "@mantine/core";

import type {
  LifecycleLogEntry,
  LifecycleStatus,
  ProcessingMode
} from "../../stores/topoViewerStore";
import { calculateElapsedSeconds, formatElapsedSeconds } from "../../utils/lifecycleTimer";

interface LifecycleProgressModalProps {
  isOpen: boolean;
  isProcessing: boolean;
  mode: ProcessingMode;
  status: LifecycleStatus;
  statusMessage?: string | null;
  labName: string;
  logs: LifecycleLogEntry[];
  onClose: () => void;
  onCancel: () => void;
}

function getModeLabel(mode: ProcessingMode): string {
  switch (mode) {
    case "destroy":
      return "Destroying";
    case "apply":
      return "Applying";
    case "start":
      return "Starting";
    case "stop":
      return "Stopping";
    case "restart":
      return "Restarting";
    case "deploy":
    default:
      return "Deploying";
  }
}

function getStatusLabel(status: LifecycleStatus): string {
  if (status === "success") {
    return "Completed";
  }
  if (status === "error") {
    return "Failed";
  }
  return "In Progress";
}

function getStatusColor(status: LifecycleStatus): "blue" | "green" | "red" {
  if (status === "success") {
    return "green";
  }
  if (status === "error") {
    return "red";
  }
  return "blue";
}

function renderStatusIcon(status: LifecycleStatus, isProcessing: boolean): React.ReactElement {
  if (isProcessing) {
    return <Loader size={20} />;
  }
  if (status === "success") {
    return <IconCircleCheck size={22} />;
  }
  if (status === "error") {
    return <IconAlertCircle size={22} />;
  }
  return <IconRefresh size={20} />;
}

function renderStatusChipIcon(status: LifecycleStatus, isProcessing: boolean): React.ReactElement {
  if (isProcessing) {
    return <IconRefresh size={18} />;
  }
  if (status === "success") {
    return <IconCircleCheck size={18} />;
  }
  if (status === "error") {
    return <IconAlertCircle size={18} />;
  }
  return <IconRefresh size={18} />;
}

export const LifecycleProgressModal: React.FC<LifecycleProgressModalProps> = ({
  isOpen,
  isProcessing,
  mode,
  status,
  statusMessage,
  labName,
  logs,
  onClose,
  onCancel
}) => {
  const logContainerRef = React.useRef<HTMLDivElement | null>(null);
  const wasProcessingRef = React.useRef(isProcessing);
  const [startedAtMs, setStartedAtMs] = React.useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);

  React.useEffect(() => {
    if (!isOpen) {
      setStartedAtMs(null);
      setElapsedSeconds(0);
      return;
    }

    if (!isProcessing || status !== "running") {
      return;
    }

    const startedAt = Date.now();
    setStartedAtMs(startedAt);
    setElapsedSeconds(0);

    const intervalId = window.setInterval(() => {
      setElapsedSeconds(calculateElapsedSeconds(startedAt));
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isOpen, isProcessing, status]);

  React.useEffect(() => {
    if (isOpen && wasProcessingRef.current && !isProcessing && startedAtMs !== null) {
      setElapsedSeconds(calculateElapsedSeconds(startedAtMs));
    }
    wasProcessingRef.current = isProcessing;
  }, [isOpen, isProcessing, startedAtMs]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const container = logContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }, [isOpen, logs]);

  const modeLabel = getModeLabel(mode);
  const statusLabel = getStatusLabel(status);
  const statusColor = getStatusColor(status);
  const timerLabel = isProcessing ? "Elapsed" : "Duration";
  const formattedDuration = formatElapsedSeconds(elapsedSeconds);

  // Memoized so the 1s elapsed-timer tick does not rebuild every log line.
  const logItems = React.useMemo(
    () =>
      logs.map((entry, index) => (
        <Text
          key={`${entry.stream}-${index}`}
          component="div"
          size="sm"
          style={{
            fontFamily: "SFMono-Regular, Consolas, 'Liberation Mono', Menlo, Courier, monospace",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.4
          }}
        >
          {entry.line}
        </Text>
      )),
    [logs]
  );

  const modalTitle = (
    <Box style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {renderStatusIcon(status, isProcessing)}
      <Box style={{ minWidth: 0, flex: 1 }}>
        <Box style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Text size="lg" fw={600} style={{ lineHeight: 1.2 }}>
            {modeLabel} lab
          </Text>
          <Badge
            size="sm"
            variant="outline"
            color={statusColor}
            leftSection={renderStatusChipIcon(status, isProcessing)}
          >
            {statusLabel}
          </Badge>
        </Box>
        <Text size="sm" c="dimmed" style={{ marginTop: 2 }}>
          {labName || "Containerlab topology"}
        </Text>
        <Text
          size="xs"
          c="dimmed"
          style={{ display: "block", marginTop: 2 }}
          data-testid="lifecycle-timer"
        >
          {timerLabel}: {formattedDuration}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Modal
      opened={isOpen}
      onClose={isProcessing ? () => undefined : onClose}
      closeOnEscape={!isProcessing}
      closeOnClickOutside={!isProcessing}
      withCloseButton={false}
      title={modalTitle}
      size="xl"
      centered
      data-testid="lifecycle-progress-modal"
      overlayProps={{ color: "#000", backgroundOpacity: 0.35, blur: 2 }}
      styles={{ content: { overflow: "hidden" } }}
    >
      {isProcessing && <Progress value={100} animated mb="md" />}
      {statusMessage !== undefined && statusMessage !== null && statusMessage.length > 0 && (
        <Text size="sm" c="dimmed" style={{ display: "block", marginBottom: 8 }}>
          {statusMessage}
        </Text>
      )}
      <Text size="xs" c="dimmed" style={{ display: "block", marginBottom: 8 }}>
        Live command output
      </Text>
      <Box
        ref={logContainerRef}
        style={{
          border: "1px solid var(--mantine-color-default-border)",
          borderRadius: 4,
          backgroundColor: "var(--mantine-color-default)",
          minHeight: 220,
          maxHeight: 320,
          overflowY: "auto",
          padding: 10
        }}
      >
        {logs.length === 0 && (
          <Text size="sm" c="dimmed">
            Waiting for command output...
          </Text>
        )}
        {logItems}
      </Box>
      <Group justify="flex-end" mt="md">
        {isProcessing ? (
          <Button size="xs" color="gray" onClick={onCancel} data-testid="lifecycle-cancel-btn">
            Cancel
          </Button>
        ) : (
          <Button size="xs" onClick={onClose} data-testid="lifecycle-ok-btn">
            OK
          </Button>
        )}
      </Group>
    </Modal>
  );
};
