// What a form value turns into once containerlab expands its variables.
import {
  hasEnvReferences,
  hasMagicVariables,
  resolveEnvReferences,
  resolveMagicVariables,
  type TopologyVariables
} from "../../../host/topologyVariables";

export interface FieldVariableScope {
  /** The lab name containerlab runs the lab under. */
  labName: string;
  /** The node the field belongs to, for `__clabNodeName__` and `__clabNodeDir__`. */
  nodeName?: string;
  variables?: TopologyVariables;
}

function formatNames(names: string[]): string {
  return names.map((name) => `$${name}`).join(", ");
}

/**
 * A one-line preview of the value with environment variables and, where
 * containerlab expands them, magic variables resolved. Undefined when the
 * value uses neither.
 */
export function describeFieldVariables(
  value: string,
  scope: FieldVariableScope,
  magicVariables: boolean
): string | undefined {
  const usesEnv = hasEnvReferences(value);
  const usesMagic = magicVariables && hasMagicVariables(value);
  if (!usesEnv && !usesMagic) return undefined;

  const env = scope.variables?.env;
  const resolvedEnv = usesEnv ? resolveEnvReferences(value, env) : { text: value, references: [] };
  const text = usesMagic
    ? resolveMagicVariables(resolvedEnv.text, {
        labName: scope.labName,
        nodeName: scope.nodeName,
        topologyDir: scope.variables?.topologyDir,
        env
      })
    : resolvedEnv.text;

  const notes: string[] = [];
  const hostNames = resolvedEnv.references.filter((ref) => ref.source === "host").map((ref) => ref.name);
  const unsetNames = resolvedEnv.references.filter((ref) => ref.source === "unset").map((ref) => ref.name);
  if (hostNames.length > 0) {
    notes.push(`defaults shown, the lab host's environment can set ${formatNames(hostNames)}`);
  }
  if (unsetNames.length > 0) {
    notes.push(`${formatNames(unsetNames)} not set`);
  }
  return `Resolves to: ${text}${notes.length > 0 ? ` (${notes.join("; ")})` : ""}`;
}
