---
title: The GUI for containerlab
template: home.html
hide:
  - navigation
  - toc
  - path
---

<div class="home-hero" markdown>
# The GUI<br> for containerlab.

Draw a network, deploy it, and look inside it. In VS Code, on your desktop, or in your browser.

<div class="hero-actions" markdown>
[Read the docs :lucide-arrow-right:](getting-started/index.md){ .hero-button .hero-button-primary }
[Try the sandbox :lucide-arrow-up-right:](https://srl-labs.github.io/containerlab-app/){ .hero-button .hero-button-secondary }
</div>

</div>

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" view="split" height="420" loading="eager"
```

<div class="demo-caption">This is the real editor's renderer. Select a node to find it in the YAML.</div>

<div class="home-section-heading" markdown>
## From drawing to a running network

The topology file stays the source of truth. The app is a faster way to write it, run it, and debug it.
</div>

<div class="home-features" markdown>
<div markdown>
<span class="card-icon">:lucide-pen-tool:</span>

### Draw

Drag nodes in, connect interfaces, or write YAML. Both views stay in sync.

[Build a topology](guides/topologies.md){ .card-link }
</div>
<div markdown>
<span class="card-icon">:lucide-play:</span>

### Deploy

Deploy, apply changes, redeploy, or destroy from one button.

[Run a lab](guides/labs.md){ .card-link }
</div>
<div markdown>
<span class="card-icon">:lucide-square-terminal:</span>

### Get in

A shell, SSH, or the logs of any node, one right-click away.

[Troubleshoot](guides/troubleshooting.md#get-into-a-node){ .card-link }
</div>
<div markdown>
<span class="card-icon">:lucide-radio-tower:</span>

### Capture

Wireshark on any link, streamed from the lab host. Nothing to install locally.

[Capture packets](guides/troubleshooting.md#capture-packets){ .card-link }
</div>
<div markdown>
<span class="card-icon">:lucide-activity:</span>

### Break things

Add delay, jitter, loss, or rate limits to a link and watch the network react.

[Impair a link](guides/troubleshooting.md#impair-a-link){ .card-link }
</div>
<div markdown>
<span class="card-icon">:lucide-share-2:</span>

### Share

Export SVG or a Grafana dashboard, work on shared labs, or embed live diagrams like these.

[Export](guides/export.md){ .card-link }
</div>
</div>

<div class="home-section-heading" markdown>
## Runs where your labs are

Labs run on Linux next to Docker. Pick the app that gets you there.
</div>

```clab file="diagrams/architecture.clab.yml" annotations="diagrams/architecture.clab.yml.annotations.json" title="How the apps reach a lab host" height="380" borderless="true" zoom="false" pan="false" fit-padding="0.1"
```

<div class="home-cards" markdown>
<div class="home-card" markdown>
<span class="card-icon">:material-microsoft-visual-studio-code:</span>

### VS Code

Runs containerlab where VS Code runs: locally, in WSL, or over Remote SSH. Lab hosts show up next to it.

[Install the extension :lucide-arrow-up-right:](install/vscode.md){ .card-link }
</div>
<div class="home-card" markdown>
<span class="card-icon">:lucide-monitor:</span>

### Desktop

A native app for Linux, macOS, and Windows. Runs labs on your Linux computer and on your lab hosts.

[Get the desktop app :lucide-arrow-up-right:](install/desktop.md){ .card-link }
</div>
<div class="home-card" markdown>
<span class="card-icon">:lucide-globe:</span>

### Web

One container, every browser on your team, several lab hosts.

[Run the web app :lucide-arrow-up-right:](install/web.md){ .card-link }
</div>
</div>

<div class="home-bottom" markdown>
<div markdown>
### Two containers, one link, five minutes
Deploy a tiny lab and ping across it.
</div>
[Start the quick start :lucide-arrow-up-right:](getting-started/first-lab.md){ .hero-button .hero-button-primary }
</div>
