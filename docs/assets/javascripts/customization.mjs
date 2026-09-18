/** Docs-only playground. Uses the public custom element and downloadable lab files. */
const labs = {
  "midnight-fabric": { title: "Midnight fabric", palette: "midnight", number: "01" },
  "fabric-101": { title: "Fabric field notes", palette: "paper", number: "02" },
  "security-zones": { title: "Trust boundaries", palette: "sandstone", number: "03" },
  "wan-ring": { title: "The scenic route", palette: "violet", number: "04" },
  "packet-walk": { title: "Follow the packet", palette: "mint", number: "05" }
};
const themes = {
  midnight: "dark", paper: "light", sandstone: "light", violet: "dark", mint: "light", blueprint: "dark",
  synthwave: "dark", aurora: "dark", ember: "dark", porcelain: "light"
};
const nodeColors = {
  paper: ["#287761", "#63854d", "#668fa4"],
  midnight: ["#d4f58a", "#63d7cb", "#a3b9dc"],
  blueprint: ["#a3e7ff", "#78b6f4", "#e2efff"],
  synthwave: ["#ff6ad5", "#46f0e0", "#ffd36d"],
  aurora: ["#63e6be", "#79cfff", "#c5b3ff"],
  ember: ["#ffb36b", "#ee8274", "#e5c99a"],
  porcelain: ["#bc5e59", "#327f83", "#7774a6"]
};
const assetUrl = (id, suffix = "") => new URL(`../../examples/${id}.clab.yml${suffix}`, import.meta.url);
const colorKeys = ["surface", "raised", "text", "muted", "accent", "edge", "border"];

function customizeAnnotations(source, settings, colors) {
  const annotations = structuredClone(source);
  const recolor = settings.palette !== "original";
  const roles = [...new Set(annotations.nodeAnnotations.map(node => node.iconColor))];
  for (const node of annotations.nodeAnnotations) {
    if (recolor) node.iconColor = nodeColors[settings.palette][roles.indexOf(node.iconColor) % nodeColors[settings.palette].length];
    node.iconCornerRadius = Number(settings.corners);
    if (!settings.groups) delete node.groupId;
  }
  for (const [key, visible] of Object.entries({ groupStyleAnnotations: settings.groups, freeTextAnnotations: settings.notes, freeShapeAnnotations: settings.shapes })) {
    if (!visible) annotations[key] = [];
  }
  if (recolor) {
    for (const group of annotations.groupStyleAnnotations) {
      Object.assign(group, { backgroundColor: colors.raised, borderColor: colors.border, labelColor: colors.muted });
    }
    for (const note of annotations.freeTextAnnotations) {
      note.fontColor = note.fontSize >= 24 ? colors.text : colors.muted;
      if (note.backgroundColor && note.backgroundColor !== "transparent") note.backgroundColor = colors.raised;
    }
    for (const shape of annotations.freeShapeAnnotations) {
      shape.borderColor = colors.accent;
      if (shape.fillColor) shape.fillColor = colors.raised;
    }
    annotations.viewerSettings.gridColor = colors.border;
  }
  annotations.viewerSettings.linkLabelMode = settings["link-labels"];
  return annotations;
}

class ClabCustomizer extends HTMLElement {
  connectedCallback() {
    if (this.abort) return;
    this.form = this.querySelector("form");
    if (!this.form) return;
    this.abort = new AbortController();
    this.cache = new Map();
    const { signal } = this.abort;
    this.form.hidden = false;
    this.querySelector(".studio-export").hidden = false;
    this.form.addEventListener("submit", event => event.preventDefault(), { signal });
    this.form.addEventListener("change", () => this.render(), { signal });
    this.form.addEventListener("input", () => this.updateOutputs(), { signal });
    this.form.addEventListener("reset", event => {
      event.preventDefault();
      // Reset only appearance controls; the chosen lab stays selected.
      for (const control of this.form.elements) {
        if (!control.name || control.name === "lab") continue;
        if (control instanceof HTMLSelectElement) control.selectedIndex = 0;
        else if (control.type === "checkbox") control.checked = control.defaultChecked;
        else control.value = control.defaultValue;
      }
      this.updateOutputs();
      this.render();
    }, { signal });
    this.querySelector("[data-copy]").addEventListener("click", () => this.copyRecipe(), { signal });
    this.querySelector("[data-annotations]").addEventListener("click", () => this.downloadAnnotations(), { signal });
    this.render();
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.request?.abort();
    this.abort = null;
    this.clearDownload();
  }

  updateOutputs() {
    for (const output of this.querySelectorAll("output[data-for]")) {
      const name = output.dataset.for;
      output.textContent = `${this.form.elements.namedItem(name).value} ${name === "padding" ? "%" : "px"}`;
    }
  }

  settings() {
    return Object.fromEntries([...this.form.elements].filter(element => element.name).map(element => [element.name, element.type === "checkbox" ? element.checked : element.value]));
  }

  async loadLab(id, signal) {
    if (this.cache.has(id)) return this.cache.get(id);
    const [yaml, annotations] = await Promise.all(["", ".annotations.json"].map(async suffix => {
      const response = await fetch(assetUrl(id, suffix), { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return suffix ? response.json() : response.text();
    }));
    const data = { yaml, annotations };
    this.cache.set(id, data);
    return data;
  }

  status(message, error = false) {
    const status = this.querySelector(".studio-status");
    status.textContent = message;
    status.toggleAttribute("data-error", error);
  }

  async render() {
    this.request?.abort();
    this.request = new AbortController();
    const { signal } = this.request;
    const settings = this.settings();
    const lab = labs[settings.lab];
    const exports = this.querySelectorAll("[data-copy], [data-annotations]");
    for (const button of exports) button.disabled = true;
    this.querySelector("[data-yaml]").removeAttribute("href");
    this.status("Loading your lab…");
    try {
      const source = await this.loadLab(settings.lab, signal);
      if (signal.aborted || !this.isConnected) return;
      const palette = settings.palette === "original" ? lab.palette : settings.palette;
      const stage = this.querySelector(".studio-preview");
      stage.dataset.palette = palette;
      stage.dataset.transparent = String(settings.transparent);
      const style = getComputedStyle(stage);
      const colors = Object.fromEntries(colorKeys.map(key => [key, style.getPropertyValue(`--studio-${key === "surface" ? "bg" : key}`).trim()]));
      const annotations = customizeAnnotations(source.annotations, settings, colors);
      const attributes = {
        title: lab.title,
        theme: themes[palette],
        borderless: String(settings.presentation === "figure"),
        view: settings.presentation === "split" ? "split" : "topology",
        grid: settings.grid,
        "link-labels": settings["link-labels"],
        height: settings.height,
        "fit-padding": String(Number(settings.padding) / 100)
      };
      for (const key of ["controls", "node-labels", "zoom", "pan", "transparent"]) attributes[key] = String(settings[key]);
      const component = document.createElement("clab-topology");
      for (const [key, value] of Object.entries(attributes)) component.setAttribute(key, value);
      component.setAttribute("filename", `${settings.lab}.clab.yml`);
      component.setAttribute("annotations", JSON.stringify(annotations));
      component.setAttribute("loading", "eager");
      const pre = document.createElement("pre");
      pre.textContent = source.yaml;
      component.append(pre);
      this.querySelector("[data-preview]").replaceChildren(component);
      this.querySelector("[data-lab-caption]").textContent = `${lab.number} / ${lab.title.toUpperCase()}`;
      this.querySelector("[data-yaml]").href = assetUrl(settings.lab).href;
      this.current = { id: settings.lab, annotations };
      this.recipe = this.createRecipe(settings.lab, attributes, colors, style.backgroundImage);
      this.querySelector("[data-recipe]").textContent = this.recipe;
      for (const button of exports) button.disabled = false;
      this.status("");
    } catch (error) {
      if (signal.aborted) return;
      this.status(`Could not load this lab (${error.message}). Choose another lab or reset the style to retry.`, true);
    }
  }

  createRecipe(id, attributes, colors, backdrop) {
    const options = Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(" ");
    const css = colorKeys.map(key => `  --clab-${key}: ${colors[key]};`).join("\n");
    // A page-local class keeps the recipe independent from the studio stylesheet.
    return `<style>\n.lab-${id} {\n  background: ${colors.surface};\n  background-image: ${backdrop};\n}\n.lab-${id} clab-topology {\n${css}\n}\n</style>\n\n<div class="lab-${id}" markdown>\n\n\`\`\`clab file="examples/${id}.clab.yml" annotations="examples/${id}.clab.yml.annotations.json" ${options}\n\`\`\`\n\n</div>`;
  }

  async copyRecipe() {
    try {
      await navigator.clipboard.writeText(this.recipe);
      if (this.isConnected) this.status("Recipe copied. Download the YAML and your customized annotations alongside it.");
    } catch {
      this.querySelector("details").open = true;
      this.status("Clipboard unavailable. Select and copy the recipe below.");
    }
  }

  clearDownload() {
    clearTimeout(this.downloadTimer);
    if (this.downloadUrl) URL.revokeObjectURL(this.downloadUrl);
    this.downloadUrl = null;
  }

  downloadAnnotations() {
    this.clearDownload();
    this.downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(this.current.annotations, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = this.downloadUrl;
    link.download = `${this.current.id}.clab.yml.annotations.json`;
    link.click();
    this.downloadTimer = setTimeout(() => this.clearDownload(), 1000);
    this.status("Customized annotations downloaded.");
  }
}

customElements.define("clab-customizer", ClabCustomizer);
// Delegation survives Zensical instant navigation without holding detached pages.
document.addEventListener("click", event => {
  const link = event.target.closest?.("[data-remix]");
  const studio = document.querySelector("clab-customizer");
  if (!link || !studio?.form) return;
  studio.form.elements.namedItem("lab").value = link.dataset.remix;
  studio.form.reset();
});
