export interface TopologyRef {
  topologyId: string;
  labName: string;
  yamlPath: string;
  annotationsPath?: string;
  source: "vscode" | "standalone";
}
