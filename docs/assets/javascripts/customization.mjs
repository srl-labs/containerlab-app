/** Docs-only playground. Uses the public custom element and downloadable lab files. */
const labs = {
  "midnight-fabric": { title: "Leaf-spine fabric", palette: "midnight", number: "01" },
  "fabric-101": { title: "Fabric 101 addressing", palette: "paper", number: "02" },
  "security-zones": { title: "Security zones", palette: "sandstone", number: "03" },
  "wan-ring": { title: "WAN ring", palette: "violet", number: "04" },
  "packet-walk": { title: "Packet walk", palette: "mint", number: "05" },
  "dual-homed": { title: "Dual-homed hosts", palette: "blueprint", number: "06" },
  "branch-office": { title: "Branch office", palette: "porcelain", number: "07" },
  "frosted-glass": { title: "Frosted glass", palette: "synthwave", number: "08" }
};
const themes = {
  midnight: "dark", paper: "light", sandstone: "light", violet: "dark", mint: "light", blueprint: "dark",
  synthwave: "dark", aurora: "dark", ember: "dark", porcelain: "light"
};
const nodeColors = {
  paper: ["#287761", "#63854d", "#668fa4"],
  midnight: ["#d4f58a", "#63d7cb", "#a3b9dc"],
  blueprint: ["#e8a33d", "#2f7fd1", "#3a9cc4"],
  synthwave: ["#ff6ad5", "#46f0e0", "#ffd36d"],
  aurora: ["#63e6be", "#79cfff", "#c5b3ff"],
  ember: ["#ffb36b", "#ee8274", "#e5c99a"],
  porcelain: ["#bc5e59", "#327f83", "#7774a6"]
};
const assetUrl = (id, suffix = "") => new URL(`../../examples/${id}.clab.yml${suffix}`, import.meta.url);
const colorKeys = ["surface", "raised", "text", "muted", "accent", "edge", "border"];
const units = { height: "px", corners: "px", padding: "%" };
// Changing these needs a fresh viewer; everything else redraws the current one in place.
const rebuildKeys = ["lab", "presentation"];
// Sliders redraw while dragging, but not on every pixel.
const SLIDER_DELAY_MS = 140;

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
  const viewerSettings = annotations.viewerSettings;
  if (settings.telemetry) {
    Object.assign(viewerSettings, { style: "telemetry-style", linkLabelMode: "telemetry-style", lastNonTelemetryLinkLabelMode: settings["link-labels"] });
  } else {
    delete viewerSettings.style;
    viewerSettings.linkLabelMode = settings["link-labels"];
  }
  // An empty choice keeps the style the lab was designed with.
  if (settings["node-style"]) viewerSettings.nodeStyle = settings["node-style"];
  if (settings["link-style"]) viewerSettings.linkStyle = settings["link-style"];
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
    this.form.addEventListener("input", event => {
      this.updateOutputs();
      if (event.target.type !== "range") return;
      clearTimeout(this.sliderTimer);
      this.sliderTimer = setTimeout(() => this.render(), SLIDER_DELAY_MS);
    }, { signal });
    this.form.addEventListener("reset", event => {
      event.preventDefault();
      this.resetStyle();
    }, { signal });
    this.addEventListener("clab:loaded", () => this.setLive(false), { signal });
    this.querySelector("[data-copy]").addEventListener("click", () => this.copyRecipe(), { signal });
    this.querySelector("[data-annotations]").addEventListener("click", () => this.downloadAnnotations(), { signal });
    // The page already renders the selected lab; restyle that viewer instead of loading a second one.
    const initial = this.querySelector("[data-preview] clab-topology");
    if (initial) {
      const { lab, presentation } = this.settings();
      this.component = initial;
      this.built = { lab, presentation };
    }
    this.render();
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.request?.abort();
    clearTimeout(this.sliderTimer);
    this.abort = null;
    this.component = null;
    this.clearDownload();
  }

  /** Reset the settings; the chosen lab stays selected. */
  resetStyle() {
    for (const control of this.form.elements) {
      if (!control.name || control.name === "lab") continue;
      if (control instanceof HTMLSelectElement) control.selectedIndex = 0;
      else if (control.type === "checkbox" || control.type === "radio") control.checked = control.defaultChecked;
      else control.value = control.defaultValue;
    }
    this.updateOutputs();
    this.render();
  }

  updateOutputs() {
    for (const output of this.querySelectorAll("output[data-for]")) {
      const name = output.dataset.for;
      output.textContent = `${this.form.elements.namedItem(name).value} ${units[name]}`;
    }
  }

  settings() {
    const settings = {};
    for (const element of this.form.elements) {
      if (!element.name) continue;
      if (element.type === "radio") {
        if (element.checked) settings[element.name] = element.value;
      } else settings[element.name] = element.type === "checkbox" ? element.checked : element.value;
    }
    return settings;
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

  setLive(updating) {
    const stage = this.querySelector(".studio-preview");
    stage.toggleAttribute("data-updating", updating);
    this.querySelector("[data-live-status]").textContent = updating ? "UPDATING…" : "PREVIEW";
  }

  async render() {
    this.request?.abort();
    this.request = new AbortController();
    const { signal } = this.request;
    const settings = this.settings();
    const lab = labs[settings.lab];
    const exports = this.querySelectorAll("[data-copy], [data-annotations]");
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
      // Telemetry style replaces the interface names, so the viewer takes the label mode from the annotations.
      for (const radio of this.form.querySelectorAll("[name='link-labels']")) radio.disabled = settings.telemetry;
      const attributes = {
        title: lab.title,
        theme: themes[palette],
        borderless: String(settings.presentation === "figure"),
        view: settings.presentation === "split" ? "split" : "topology",
        grid: settings.grid,
        ...(settings.telemetry ? {} : { "link-labels": settings["link-labels"] }),
        ...(settings["link-style"] ? { "link-style": settings["link-style"] } : {}),
        height: settings.height,
        "fit-padding": String(Number(settings.padding) / 100)
      };
      for (const key of ["controls", "node-labels", "link-hover", "zoom", "pan", "transparent"]) attributes[key] = String(settings[key]);

      const rebuild = !this.component?.isConnected || rebuildKeys.some(key => this.built?.[key] !== settings[key]);
      if (rebuild) this.mount(settings, source, attributes, annotations);
      else this.update(attributes, annotations);
      this.built = settings;
      this.appliedAttributes = attributes;

      this.querySelector("[data-lab-caption]").textContent = `${lab.number} / ${lab.title.toUpperCase()}`;
      this.querySelector("[data-yaml]").href = assetUrl(settings.lab).href;
      this.current = { id: settings.lab, annotations };
      this.recipe = this.createRecipe(settings.lab, attributes, colors, style.backgroundImage);
      this.querySelector("[data-recipe]").textContent = this.recipe;
      for (const button of exports) button.disabled = false;
      this.status("");
    } catch (error) {
      if (signal.aborted) return;
      for (const button of exports) button.disabled = true;
      this.querySelector("[data-yaml]").removeAttribute("href");
      this.setLive(false);
      this.status(`Could not load this lab (${error.message}). Choose another lab or reset the settings to try again.`, true);
    }
  }

  /** A new lab or presentation needs a fresh viewer. */
  mount(settings, source, attributes, annotations) {
    const component = document.createElement("clab-topology");
    for (const [key, value] of Object.entries(attributes)) component.setAttribute(key, value);
    component.setAttribute("filename", `${settings.lab}.clab.yml`);
    component.setAttribute("annotations", JSON.stringify(annotations));
    component.setAttribute("loading", "eager");
    const pre = document.createElement("pre");
    pre.textContent = source.yaml;
    component.append(pre);
    this.querySelector("[data-preview]").replaceChildren(component);
    this.component = component;
    this.setLive(false);
  }

  /** Redraw the current viewer with new colors and options. */
  update(attributes, annotations) {
    const component = this.component;
    for (const name of Object.keys(this.appliedAttributes ?? {})) {
      if (!(name in attributes)) component.removeAttribute(name);
    }
    for (const [key, value] of Object.entries(attributes)) component.setAttribute(key, value);
    component.setAttribute("annotations", JSON.stringify(annotations));
    this.setLive(true);
    component.refresh();
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
      if (this.isConnected) this.status("Markdown copied. Save the topology and annotations files next to the page.");
    } catch {
      this.querySelector("details").open = true;
      this.status("The clipboard is unavailable. Select and copy the Markdown below.");
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
    this.status("Annotations downloaded.");
  }
}

customElements.define("clab-customizer", ClabCustomizer);
// Delegation survives Zensical instant navigation without holding detached pages.
document.addEventListener("click", event => {
  const link = event.target.closest?.("[data-remix]");
  const studio = document.querySelector("clab-customizer");
  if (!link || !studio?.form) return;
  studio.form.elements.namedItem("lab").value = link.dataset.remix;
  studio.resetStyle();
});
