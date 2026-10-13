export interface WiresharkVncInitialData {
  iframeUrl: string;
  showVolumeTip: boolean;
  /** Shown under the loading title until the host reports progress. */
  initialStatus?: string;
}

/** One capture session shown by the multi-session page. */
export interface WiresharkVncTab {
  id: string;
  /** The interfaces as the user knows them, e.g. 1/1/c1/1, 1/1/c2/1. */
  label: string;
  /** Single-session Wireshark page for this session. */
  src: string;
}

export type WiresharkVncLayout = "tabs" | "side-by-side";
