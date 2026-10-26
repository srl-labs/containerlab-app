import type { HostNodeStatsSample } from "../../host/contracts";
import type { LabOverviewCard, LabThumbnailSources } from "../../workspace/state/labsOverview";

/** What the labs overview webview shows; the host sends it again whenever labs change. */
export interface LabsOverviewWebviewState {
  cards: LabOverviewCard[];
  /** The first listing of labs has not finished. */
  loading: boolean;
  /** Show each card's lab host, when there is more than one. */
  showEndpoints: boolean;
  /** Changes when topology files change, so visible thumbnails draw again. */
  sourcesRevision: number;
}

export type LabsOverviewWebviewInitialData = Partial<LabsOverviewWebviewState>;

export type LabsOverviewAction = "open" | "deploy" | "destroy";

/** Webview to host. */
export type LabsOverviewOutgoingMessage =
  | { type: "labs-overview:ready" }
  | { type: "labs-overview:action"; action: LabsOverviewAction; cardId: string }
  | { type: "labs-overview:create-lab" }
  | { type: "labs-overview:load-sources"; requestId: number; cardId: string }
  | {
      type: "labs-overview:usage-start";
      streamId: number;
      endpointId: string;
      labName: string;
      intervalSeconds: number;
    }
  | { type: "labs-overview:usage-stop"; streamId: number };

/** Host to webview. */
export type LabsOverviewIncomingMessage =
  | ({ type: "labs-overview:state" } & LabsOverviewWebviewState)
  | { type: "labs-overview:sources"; requestId: number; sources?: LabThumbnailSources }
  | {
      type: "labs-overview:usage";
      streamId: number;
      sample?: HostNodeStatsSample;
      /** The stream ended; with `error` it failed, with `status` 501 the lab host cannot report usage. */
      end?: boolean;
      error?: string;
      status?: number;
    };
