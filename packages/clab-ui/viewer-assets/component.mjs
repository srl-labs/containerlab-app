/** Framework-independent documentation component. Each iframe isolates clab-ui's stores. */
const viewerUrl = new URL("viewer.html", import.meta.url);
const instances = new Set();
let sequence = 0;

const icons = {
  topology: '<path d="M8 5h8M6 7v10m12-10v10M8 19h8"/><rect x="3" y="2" width="6" height="6" rx="2"/><rect x="15" y="2" width="6" height="6" rx="2"/><rect x="3" y="16" width="6" height="6" rx="2"/><rect x="15" y="16" width="6" height="6" rx="2"/>',
  yaml: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M12 4v16"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  fit: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const button = (action, label) => `<button class="clab-icon-button" type="button" data-action="${action}" aria-label="${label}" title="${label}">${icon(action)}</button>`;
const theme = () => document.body.dataset.mdColorScheme === "slate" ? "dark" : "light";

export class ClabTopology extends HTMLElement {
  connectedCallback() {
    if (this.abort) return;
    this.abort = new AbortController();
    instances.add(this);
    if (!this.built) this.build();
    const { signal } = this.abort;
    this.addEventListener("click", (event) => this.onClick(event), { signal });
    this.addEventListener("keydown", (event) => this.onKeydown(event), { signal });
    this.querySelector("select").addEventListener("change", (event) => {
      this.send({ type: "clab-viewer:focus", id: event.target.value });
    }, { signal });
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        this.nearViewport = true;
        this.ensureViewer();
        this.observer.disconnect();
      }
    }, { rootMargin: "240px" });
    this.observer.observe(this);
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.abort = null;
    this.observer?.disconnect();
    clearTimeout(this.loadTimeout);
    clearTimeout(this.copyTimeout);
    instances.delete(this);
    // Instant navigation may restore the element. Start a fresh handshake on reconnect.
    this.frame?.remove();
    this.frame = null;
    this.ready = false;
    delete this.dataset.loaded;
  }

  build() {
    this.built = true;
    this.classList.add("no-copy");
    const id = `clab-${++sequence}`;
    const source = this.querySelector("[data-clab-source]");
    const pre = this.querySelector(".clab-source") ?? this.querySelector("pre");
    this.yaml = source?.textContent ?? pre?.textContent ?? "";
    this.nodes = [];
    this.style.setProperty("--clab-height", `${Math.min(1000, Math.max(240, Number(this.getAttribute("height")) || 460))}px`);
    // All dynamic author content is assigned through textContent, never innerHTML.
    this.innerHTML = `
      <div class="clab-component-heading"><span class="clab-component-mark">${icon("topology")}</span><strong></strong><span class="clab-live-badge"><i></i> INTERACTIVE</span></div>
      <div class="clab-toolbar">
        <div class="clab-tabs" role="tablist" aria-label="Topology presentation">
          ${["topology", "yaml", "split"].map((view) => `<button type="button" role="tab" id="${id}-${view}" aria-controls="${id}-panel" data-view="${view}">${icon(view)}<span>${view === "yaml" ? "YAML" : view === "split" ? "Split" : "Topology"}</span></button>`).join("")}
        </div>
        <div class="clab-actions">${button("fit", "Fit topology")}${button("copy", "Copy YAML")}${button("download", "Download YAML")}${button("expand", "Expand example")}</div>
      </div>
      <div class="clab-panels" id="${id}-panel" role="tabpanel" tabindex="0">
        <div class="clab-graph"><div class="clab-loading" role="status"><span class="clab-loader"></span><span data-clab-status>Preparing your topology…</span></div></div>
        <div class="clab-code"><div class="clab-file-label">${icon("yaml")}<span></span></div></div>
      </div>
      <div class="clab-inspector"><label><span class="clab-sr-only">Inspect a node</span><select aria-label="Inspect a node"><option value="">Inspect a node…</option></select></label><span class="clab-node-detail">Select a node to explore its configuration.</span><button type="button" data-action="source" hidden>Show in YAML ↗</button></div>
      <div class="clab-component-footer"><span class="clab-counts">YAML → topology</span><span class="clab-hint">Drag to pan · Pinch to zoom</span><span class="clab-feedback" role="status" aria-live="polite"></span></div>`;
    this.querySelector(".clab-component-heading strong").textContent = this.getAttribute("title") || "Network topology";
    this.querySelector(".clab-file-label span").textContent = this.getAttribute("filename") || "topology.clab.yml";
    this.pre = pre ?? document.createElement("pre");
    if (!pre) this.pre.textContent = this.yaml;
    if (!this.pre.querySelector("[data-line]")) {
      const code = document.createElement("code");
      this.yaml.replace(/\n$/, "").split("\n").forEach((text, index) => {
        if (index > 0) code.append("\n");
        const line = document.createElement("span");
        line.className = "clab-code-line";
        line.dataset.line = String(index + 1);
        line.textContent = text || " ";
        code.append(line);
      });
      this.pre.replaceChildren(code);
    }
    this.pre.className = "clab-source";
    this.pre.removeAttribute("hidden");
    this.pre.tabIndex = 0;
    this.pre.setAttribute("aria-label", "Topology YAML source");
    this.querySelector(".clab-code").append(this.pre);
    if (!this.requestFullscreen) this.querySelector('[data-action="expand"]').hidden = true;
    this.setView(this.getAttribute("view") || "topology");
  }

  setView(view) {
    if (!["topology", "yaml", "split"].includes(view)) view = "topology";
    this.dataset.view = view;
    for (const tab of this.querySelectorAll('[role="tab"]')) {
      const selected = tab.dataset.view === view;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected) this.querySelector('[role="tabpanel"]').setAttribute("aria-labelledby", tab.id);
    }
    this.querySelector(".clab-graph").hidden = view === "yaml";
    this.querySelector(".clab-code").hidden = view === "topology";
    this.querySelector('[data-action="fit"]').disabled = view === "yaml";
    if (this.nearViewport) this.ensureViewer();
  }

  ensureViewer() {
    if (this.frame || this.dataset.view === "yaml") return;
    const url = new URL(this.getAttribute("viewer-src") || viewerUrl.href, document.baseURI);
    url.searchParams.set("parentOrigin", location.origin);
    this.frameOrigin = url.origin;
    this.frame = document.createElement("iframe");
    this.frame.title = `${this.getAttribute("title") || "Network"} — interactive topology`;
    this.frame.src = url.href;
    this.frame.setAttribute("allow", "fullscreen");
    this.querySelector(".clab-graph").append(this.frame);
    this.loading("Preparing your topology…");
    this.loadTimeout = setTimeout(() => this.loading("The viewer could not load. Your YAML is still available.", true), 30000);
  }

  loading(message, error = false) {
    const loader = this.querySelector(".clab-loading");
    loader.hidden = false;
    loader.classList.toggle("clab-load-error", error);
    loader.querySelector("[data-clab-status]").textContent = message;
    if (error && !loader.querySelector("button")) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.dataset.action = "retry";
      retry.textContent = "Retry viewer";
      loader.append(retry);
    }
  }

  send(message) {
    this.frame?.contentWindow?.postMessage(message, this.frameOrigin);
  }

  receive(message) {
    if (message.type === "clab-viewer:ready") {
      this.send({ type: "clab-viewer:render", yaml: this.yaml, annotations: this.getAttribute("annotations") ?? undefined, theme: theme() });
    } else if (message.type === "clab-viewer:loaded") {
      clearTimeout(this.loadTimeout);
      this.ready = true;
      this.querySelector(".clab-loading").hidden = true;
      this.nodes = message.nodes;
      const select = this.querySelector("select");
      select.length = 1;
      for (const node of this.nodes) select.add(new Option(node.id, node.id));
      this.querySelector(".clab-counts").textContent = `${this.nodes.length} nodes · ${message.links} links`;
      this.dataset.loaded = "true";
    } else if (message.type === "clab-viewer:select") {
      this.inspect(message.id);
    } else if (message.type === "clab-viewer:error") {
      clearTimeout(this.loadTimeout);
      this.loading(message.message, true);
    }
  }

  inspect(id) {
    this.selected = this.nodes.find((node) => node.id === id);
    this.querySelector("select").value = this.selected?.id ?? "";
    const detail = this.querySelector(".clab-node-detail");
    detail.textContent = this.selected ? `${this.selected.kind}${this.selected.image ? ` · ${this.selected.image}` : ""}` : "Select a node to explore its configuration.";
    detail.title = detail.textContent;
    this.querySelector('[data-action="source"]').hidden = !this.selected;
    for (const line of this.pre.querySelectorAll("[data-line]")) {
      const n = Number(line.dataset.line);
      line.classList.toggle("clab-line-selected", Boolean(this.selected && n >= this.selected.startLine && n <= this.selected.endLine));
    }
    if (this.dataset.view !== "topology") this.revealSource();
  }

  revealSource() {
    const line = this.pre.querySelector(".clab-line-selected");
    // Scroll only the code pane, never the surrounding documentation page.
    if (line) this.pre.scrollTop += line.getBoundingClientRect().top - this.pre.getBoundingClientRect().top - 48;
  }

  async onClick(event) {
    const target = event.target.closest("button");
    if (!target || !this.contains(target)) return;
    if (target.dataset.view) { this.setView(target.dataset.view); return; }
    const action = target.dataset.action;
    const feedback = this.querySelector(".clab-feedback");
    if (action === "fit") this.send({ type: "clab-viewer:fit" });
    if (action === "source") { this.setView("split"); this.revealSource(); }
    if (action === "copy") {
      try {
        await navigator.clipboard.writeText(this.yaml);
        feedback.textContent = "YAML copied";
      } catch { feedback.textContent = "Select the YAML and copy it manually."; this.setView("yaml"); }
      clearTimeout(this.copyTimeout);
      this.copyTimeout = setTimeout(() => { feedback.textContent = ""; }, 3000);
    }
    if (action === "download") {
      const url = URL.createObjectURL(new Blob([this.yaml], { type: "application/yaml" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = this.getAttribute("filename") || "topology.clab.yml";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    if (action === "expand") {
      try {
        if (document.fullscreenElement === this) await document.exitFullscreen();
        else await this.requestFullscreen();
      } catch { feedback.textContent = "Full screen is unavailable in this browser."; }
    }
    if (action === "retry") {
      clearTimeout(this.loadTimeout);
      this.frame?.remove();
      this.frame = null;
      this.querySelector('.clab-loading button')?.remove();
      this.ensureViewer();
    }
  }

  onKeydown(event) {
    if (event.target.getAttribute("role") !== "tab") return;
    const tabs = [...this.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(event.target);
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    this.setView(tabs[next].dataset.view);
    tabs[next].focus();
  }
}

window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  for (const instance of instances) {
    if (event.source === instance.frame?.contentWindow && event.origin === instance.frameOrigin) {
      instance.receive(event.data);
      break;
    }
  }
});
document.addEventListener("fullscreenchange", () => {
  for (const instance of instances) {
    const button = instance.querySelector('[data-action="expand"]');
    const label = document.fullscreenElement === instance ? "Exit full screen" : "Expand example";
    button.setAttribute("aria-label", label);
    button.title = label;
  }
});
new MutationObserver(() => {
  for (const instance of instances) instance.send({ type: "clab-viewer:theme", theme: theme() });
}).observe(document.body, { attributes: true, attributeFilter: ["data-md-color-scheme"] });

if (!customElements.get("clab-topology")) customElements.define("clab-topology", ClabTopology);
