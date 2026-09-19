export interface TopologyRef {
  topologyId: string;
  labName: string;
  yamlPath: string;
  /** Exact API-server source path used to match runtime labs. File operations use yamlPath. */
  absoluteYamlPath?: string;
  annotationsPath?: string;
  source: "vscode" | "standalone";
}
