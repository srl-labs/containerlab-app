---
title: Network labs, brought to life
template: home.html
hide:
  - navigation
  - toc
  - path
---

<div class="home-hero" markdown>
<div class="hero-eyebrow"><span></span> THE CONTAINERLAB APPS DOCUMENTATION</div>

# Your network.<br>All the possibilities.

Design it. Understand it. Bring it to life. A shared workspace for your network labs, in VS Code, on your desktop, and in your browser.

<div class="hero-actions" markdown>
[Build your first lab :lucide-arrow-up-right:](getting-started/first-lab.md){ .hero-button .hero-button-primary }
[Find your app :lucide-arrow-right:](getting-started/index.md){ .hero-button .hero-button-secondary }
</div>

<div class="hero-caption"><span class="hero-line"></span> REAL TOPOLOGIES. RIGHT HERE IN THE DOCS.<span class="hero-line"></span></div>
</div>

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="A small fabric. A whole world to explore." view="split" height="420"
```

<div class="demo-caption"><span>Go ahead, explore.</span> Select a node. Follow a link. Switch to YAML. This is the actual topology viewer.</div>

<div class="home-platforms" markdown>
<span>ONE WORKSPACE. YOUR CHOICE OF HOME.</span>
<div markdown>

:material-microsoft-visual-studio-code: VS Code &nbsp;&nbsp;&nbsp;&nbsp; :lucide-monitor: Desktop &nbsp;&nbsp;&nbsp;&nbsp; :lucide-globe: Browser

</div>
</div>

<div class="home-section-heading" markdown>
<span class="section-eyebrow">FROM AN IDEA TO A RUNNING NETWORK</span>

## Less setup. More discovery.

Everything you need to move from a topology file to a lab you can explore.
</div>

<div class="home-cards" markdown>
<div class="home-card" markdown>
<span class="card-icon">:lucide-panels-top-left:</span><span class="card-number">01 / GET STARTED</span>

### Make yourself at home

Choose the app that fits your workflow. Connect a lab host and pick up where you left off.

[Choose your app :lucide-arrow-up-right:](getting-started/index.md){ .card-link }
</div>
<div class="home-card" markdown>
<span class="card-icon">:lucide-workflow:</span><span class="card-number">02 / DESIGN</span>

### Think in topologies

Build visually or work in YAML. Add nodes, connect interfaces, and make your network make sense.

[Explore the canvas :lucide-arrow-up-right:](guides/topologies.md){ .card-link }
</div>
<div class="home-card" markdown>
<span class="card-icon">:lucide-flask-conical:</span><span class="card-number">03 / EXPERIMENT</span>

### Follow your curiosity

Explore working examples. Read the YAML behind every connection. Download a lab and make it yours.

[Browse the gallery :lucide-arrow-up-right:](examples/index.md){ .card-link }
</div>
</div>

<div class="home-feature" markdown>
<div markdown>
<span class="section-eyebrow">DIAGRAMS THAT SPEAK YAML</span>

## The example is<br>the documentation.

Every interactive diagram starts with a real containerlab topology. Pan, zoom, and inspect the network, then see exactly how it is defined.

One source of truth. No diagram to redraw when your lab changes.

[Put a topology in your docs :lucide-arrow-right:](viewer/index.md){ .feature-link }
</div>
<div class="home-code-card" markdown>
<div class="code-card-label"><span></span> your-next-guide.md</div>

````markdown
```clab title="Hello, network"
name: hello
topology:
  defaults:
    kind: linux
    image: alpine:3.23
  nodes:
    client: {}
    server: {}
  links:
    - endpoints:
        - client:eth1
        - server:eth1
```
````

<div class="code-card-note">A little YAML. An entire interactive topology.</div>
</div>
</div>

<div class="home-bottom" markdown>
<div markdown>
### Built for the way you lab.
Open source tools. Real network operating systems. Room to experiment.
</div>
[Let's build something :lucide-arrow-up-right:](getting-started/first-lab.md){ .hero-button .hero-button-primary }
</div>
