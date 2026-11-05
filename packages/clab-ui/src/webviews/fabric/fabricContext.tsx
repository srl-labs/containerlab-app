/** What every Fabric view shares: the client, the route, the instant shown and the fabric itself. */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import type { FabricClient } from "../../fabric/engine";

import {
  isFabricChange,
  useFabricAnswer,
  useFabricLive,
  useLiveRevision,
  type FabricConnection,
  type FabricLiveSubscribe
} from "./fabricData";
import { trimCatalog } from "./fabricReports";
import { loadRoute, saveRoute, type FabricRoute } from "./fabricRoute";
import type { FabricIncident, FabricReportSpec, FabricStatus, FabricTopology } from "./fabricTypes";

export interface FabricContextValue {
  client: FabricClient;
  labName: string;
  /** The instant shown, in epoch seconds; live without one. */
  at: number | undefined;
  setAt: (at: number | undefined) => void;
  route: FabricRoute;
  go: (route: FabricRoute) => void;
  status: FabricStatus | undefined;
  topology: FabricTopology | undefined;
  incidents: FabricIncident[] | undefined;
  catalog: FabricReportSpec[] | undefined;
  /** Why the fabric could not be read. */
  coreError: string | undefined;
  reloadCore: () => void;
  connection: FabricConnection;
  subscribeLive: FabricLiveSubscribe;
  stopEngine: () => void;
}

const FabricContext = createContext<FabricContextValue | undefined>(undefined);

export function useFabric(): FabricContextValue {
  const value = useContext(FabricContext);
  if (!value) throw new Error("useFabric needs a FabricProvider");
  return value;
}

const CATALOG_REQUEST = { method: "GET", path: "reports" } as const;
const STATUS_REQUEST = { method: "GET", path: "status" } as const;

export function FabricProvider({ client, labName, onStreamClosed, stopEngine, children }: {
  client: FabricClient;
  labName: string;
  onStreamClosed: () => void;
  stopEngine: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const [route, setRoute] = useState(() => loadRoute(labName));
  const [at, setAt] = useState<number | undefined>(undefined);
  const [manualRevision, setManualRevision] = useState(0);
  const { connection, subscribe } = useFabricLive(client, at !== undefined, onStreamClosed);
  const liveRevision = useLiveRevision(subscribe, isFabricChange);
  const revision = manualRevision + liveRevision;
  const query = useMemo(() => (at === undefined ? undefined : { at: String(at) }), [at]);
  const status = useFabricAnswer<FabricStatus>(client, STATUS_REQUEST, revision);
  const topology = useFabricAnswer<FabricTopology>(client, { method: "GET", path: "topology", query }, revision);
  const incidents = useFabricAnswer<FabricIncident[]>(client, { method: "GET", path: "incidents", query }, revision);
  const catalogAnswer = useFabricAnswer<FabricReportSpec[]>(client, CATALOG_REQUEST);
  const fullCatalog = catalogAnswer.answer;
  const catalog = useMemo(() => (fullCatalog ? trimCatalog(fullCatalog) : undefined), [fullCatalog]);

  useEffect(() => {
    saveRoute(labName, route);
  }, [labName, route]);

  const reloadCore = useCallback(() => setManualRevision((value) => value + 1), []);

  const value = useMemo<FabricContextValue>(() => ({
    client,
    labName,
    at,
    setAt,
    route,
    go: setRoute,
    status: status.answer,
    topology: topology.answer,
    incidents: incidents.answer,
    catalog,
    coreError: status.error ?? topology.error ?? incidents.error,
    reloadCore,
    connection,
    subscribeLive: subscribe,
    stopEngine
  }), [
    client, labName, at, route, status.answer, status.error, topology.answer, topology.error,
    incidents.answer, incidents.error, catalog, reloadCore, connection, subscribe, stopEngine
  ]);

  return <FabricContext.Provider value={value}>{children}</FabricContext.Provider>;
}
