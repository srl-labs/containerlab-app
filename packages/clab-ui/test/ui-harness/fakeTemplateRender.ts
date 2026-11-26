// A stand-in for containerlab rendering a `.clab.gotmpl` topology template:
// just enough of Go templates for the specs. It knows `{{ .name }}`,
// `{{ $.name }}` and `{{ range $i := seq 1 .count }} … {{ end }}`, with the
// variables of `<name>.clab_vars.yml` next to the template.

const RANGE = /\{\{ *range +\$(\w+) *:= *seq +1 +\.(\w+) *\}\}([\s\S]*?)\{\{ *end *\}\}/g;

/** The `key: value` lines of a variables file. */
function parseVars(content: string | undefined): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of (content ?? "").split("\n")) {
    const match = /^(\w+):\s*(.+?)\s*$/.exec(line);
    if (match) vars[match[1]] = match[2];
  }
  return vars;
}

function lookup(vars: Record<string, string>, name: string, file: string): string {
  if (!(name in vars)) throw new Error(`template: ${file}: map has no entry for key "${name}"`);
  return vars[name];
}

function expand(template: string, vars: Record<string, string>, file: string): string {
  // `{{-` and `-}}` trim the whitespace next to them.
  const trimmed = template.replace(/\s*\{\{-/g, "{{").replace(/-\}\}\s*/g, "}}");
  const looped = trimmed.replace(RANGE, (_, index: string, count: string, body: string) =>
    Array.from({ length: Number(lookup(vars, count, file)) }, (_unused, i) =>
      body.replace(new RegExp(`\\{\\{ *\\$${index} *\\}\\}`, "g"), String(i + 1))
    ).join("")
  );
  const rendered = looped.replace(/\{\{ *\$?\.(\w+) *\}\}/g, (_, name: string) =>
    lookup(vars, name, file)
  );
  const left = /\{\{[^}]*\}\}/.exec(rendered);
  if (left) throw new Error(`template: ${file}: unexpected ${left[0]}`);
  return rendered;
}

/** The variables file containerlab finds for a template: `fabric.clab_vars.yml` for `fabric.clab.gotmpl`. */
function varsFileFor(templatePath: string): string {
  return `${templatePath.slice(0, templatePath.lastIndexOf("."))}_vars.yml`;
}

/**
 * What containerlab renders from the template at `templatePath`. A spec
 * makes it fail like a containerlab that cannot render with
 * `window.__CLAB_UI_HARNESS_RENDER_ERROR__`.
 */
export function renderFakeTemplate(
  files: ReadonlyMap<string, string>,
  templatePath: string
): { content: string; varsFiles: string[] } {
  const forced = (window as unknown as { __CLAB_UI_HARNESS_RENDER_ERROR__?: unknown })
    .__CLAB_UI_HARNESS_RENDER_ERROR__;
  if (typeof forced === "string") throw new Error(forced);
  const file = templatePath.split("/").at(-1) ?? templatePath;
  const template = files.get(templatePath);
  if (template === undefined) throw new Error(`ENOENT: no such file ${templatePath}`);
  const varsPath = varsFileFor(templatePath);
  const vars = files.get(varsPath);
  return {
    content: expand(template, parseVars(vars), file),
    varsFiles: vars === undefined ? [] : [varsPath.split("/").at(-1) ?? varsPath]
  };
}
