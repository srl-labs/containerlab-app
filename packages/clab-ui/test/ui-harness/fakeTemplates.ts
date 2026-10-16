// Node templates for the harness, kept the way the VS Code extension keeps its
// `containerlab.editor.customNodes` setting.
import type { CustomNodeTemplate } from "../../src/core/types/editors";
import { isCustomNodeTemplate } from "../../src/core/utilities/customNodeImportExport";
import type { ClabUiTopoViewerEvent } from "../../src/host/contracts";

type Template = CustomNodeTemplate;

/** The extension's default `containerlab.editor.customNodes`. */
const DEFAULT_TEMPLATES: Template[] = [
  {
    name: "SRLinux Latest",
    kind: "nokia_srlinux",
    type: "ixr-d1",
    image: "ghcr.io/nokia/srlinux:latest",
    icon: "router",
    baseName: "srl",
    interfacePattern: "e1-{n}",
    setDefault: true
  },
  {
    name: "Network Multitool",
    kind: "linux",
    image: "ghcr.io/srl-labs/network-multitool:latest",
    icon: "client",
    baseName: "client",
    interfacePattern: "eth{n}",
    setDefault: false
  }
];

export interface TemplateState {
  customNodes: Template[];
  defaultNode: string;
}

/** `seedDefaults: false` starts without templates, as the browser specs expect. */
export function createFakeTemplates(
  seedDefaults: boolean,
  emit: (event: ClabUiTopoViewerEvent) => void
) {
  let templates: Template[] = seedDefaults ? DEFAULT_TEMPLATES.map((entry) => ({ ...entry })) : [];

  const state = (): TemplateState => ({
    customNodes: templates,
    defaultNode: templates.find((entry) => entry.setDefault === true)?.name ?? ""
  });
  const publish = (next: Template[]): void => {
    templates = next;
    emit({ type: "customNodesUpdated", ...state() });
  };

  return {
    state,

    /** Add or replace a template; `oldName` renames one. */
    save(data: Record<string, unknown>): void {
      const { oldName, ...template } = data;
      if (!isCustomNodeTemplate(template)) return;
      let next = template.setDefault === true
        ? templates.map((entry) => ({ ...entry, setDefault: false }))
        : [...templates];
      const replaces = typeof oldName === "string" && oldName.length > 0 ? oldName : template.name;
      const index = next.findIndex((entry) => entry.name === replaces);
      if (index >= 0) {
        next[index] = template;
      } else {
        next = [...next, template];
      }
      publish(next);
    },

    remove(name: string): void {
      publish(templates.filter((entry) => entry.name !== name));
    },

    setDefault(name: string): void {
      if (!templates.some((entry) => entry.name === name)) return;
      publish(templates.map((entry) => ({ ...entry, setDefault: entry.name === name })));
    }
  };
}
