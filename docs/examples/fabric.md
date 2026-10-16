---
description: A small SR Linux leaf–spine fabric with three clients.
---

# Leaf–spine fabric

The shape of most data center networks: every leaf connects to every spine, and clients hang off the leaves. This file is wiring only; bring your own routing.
{ .lead }

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" view="split" height="500"
```

## Read the file

- `defaults` gives every node the SR Linux kind and image. The clients override both with a Linux image.
- Each link has two endpoints written as `node:interface`. SR Linux names its ports `e1-1`, `e1-2`, …
- Select `leaf2` and follow its two uplinks and its one client link.

## Run it

You need a Linux host with room for five SR Linux nodes and three Linux containers; check the [SR Linux requirements](https://containerlab.dev/manual/kinds/srl/). Download the file, deploy it, and open the CLI on a leaf with **Shell**.

There is no routing and no client addressing yet. That is the exercise. For something that pings right away, start with the [Linux playground](linux.md).
