import React, { useCallback, useMemo } from "react";
import Typography from "@mui/material/Typography";

import type { LabHostCheck } from "../host/labHostSupport";
import { EndpointManager } from "../workspace/components/EndpointManager";
import type { ClusterHostsSupport, EndpointHealthMetrics, KubeconfigContextList } from "../workspace/types";
import type { LocalEndpointOffer } from "../workspace/endpoints";
import type { LabHostsSnapshot } from "./schema";

type Request = (payload: Record<string, unknown>) => Promise<unknown>;

/**
 * This computer, Kubernetes clusters and lab servers, managed the way the
 * desktop and web apps manage them: add, check, sign in, edit, sign out,
 * remove. Every action goes to the extension, which answers with the new
 * state or, for checks and contexts, with what it found.
 */
export function LabHostsPanel({
  labHosts,
  request,
}: {
  labHosts: LabHostsSnapshot;
  request: Request;
}) {
  const local = labHosts.local;
  const localOffer = useMemo<LocalEndpointOffer | undefined>(
    () =>
      local
        ? {
            available: local.available,
            problems: local.problems,
            ...(local.containerlabVersion !== undefined
              ? { containerlabVersion: local.containerlabVersion }
              : {}),
            label: "Local",
            addLabel: "Show local",
            onAdd: async () => {
              await request({ action: "labHosts.showLocal" });
            },
            onCheckAgain: async () => {
              await request({ action: "labHosts.checkLocal" });
            },
          }
        : undefined,
    [local, request],
  );
  const clusters = labHosts.clusters;
  const clusterHosts = useMemo<ClusterHostsSupport | undefined>(
    () =>
      clusters && clusters.unavailable === undefined
        ? {
            ...(clusters.defaultKubeconfig !== undefined
              ? { defaultKubeconfig: clusters.defaultKubeconfig }
              : {}),
            listContexts: async (kubeconfig) =>
              (await request({
                action: "labHosts.cluster.contexts",
                ...(kubeconfig !== undefined ? { kubeconfig } : {}),
              })) as KubeconfigContextList,
            chooseKubeconfig: async () =>
              ((await request({ action: "labHosts.cluster.chooseKubeconfig" })) as { path?: string })
                .path,
            check: async (settings) =>
              (await request({ action: "labHosts.cluster.check", settings })) as LabHostCheck[],
            save: async (settings, endpointId) => {
              await request({
                action: "labHosts.cluster.save",
                settings,
                ...(endpointId !== undefined ? { endpointId } : {}),
              });
            },
          }
        : undefined,
    [clusters, request],
  );
  // Stable, so the health stats load once per sign-in and not on every render.
  const fetchHealthMetrics = useCallback(
    async (endpointId: string) =>
      (await request({
        action: "labHosts.metrics",
        endpointId,
      })) as EndpointHealthMetrics,
    [request],
  );
  const checkEndpoint = useCallback(
    async (endpointId: string) =>
      (await request({ action: "labHosts.check", endpointId })) as LabHostCheck[],
    [request],
  );
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The explorer lists the labs of every lab host. Passwords are never saved; signing in keeps a token in VS Code&apos;s secret storage.
      </Typography>
      <EndpointManager
        mode="manage"
        defaultApiUrl=""
        endpoints={labHosts.hosts}
        healthStatsEnabled
        fetchHealthMetrics={fetchHealthMetrics}
        localEndpoint={localOffer}
        thisComputerUnavailable={
          local === undefined
            ? "containerlab runs on Linux only. Use a lab server, or open this window in WSL."
            : undefined
        }
        clusterHosts={clusterHosts}
        clustersUnavailable={clusters?.unavailable}
        onCheckEndpoint={checkEndpoint}
        requestedAddKind={labHosts.add}
        onAddEndpoint={async (input) => {
          await request({ action: "labHosts.add", ...input });
        }}
        onReconnectEndpoint={async (input) => {
          await request(
            input.endpointId === "local"
              ? { action: "labHosts.checkLocal" }
              : { action: "labHosts.signIn", ...input },
          );
        }}
        onRemoveEndpoint={async (endpointId) => {
          await request({ action: "labHosts.remove", endpointId });
        }}
        onUpdateEndpoint={async (input) => {
          await request({ action: "labHosts.update", ...input });
        }}
        onSetEndpointSessionDuration={(endpointId, sessionDuration) => {
          void request({
            action: "labHosts.update",
            endpointId,
            sessionDuration,
          });
        }}
        onSignOutEndpoint={async (endpointId) => {
          await request({ action: "labHosts.signOut", endpointId });
        }}
      />
    </>
  );
}
