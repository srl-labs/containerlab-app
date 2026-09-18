# Leaf–spine fabric

The building block of a data center: each leaf connects to every spine. Clients attach at the leaves. This example describes the physical topology; configuring routing is your next experiment.

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" view="split" height="500"
```

## Read the topology

The `defaults` section supplies the SR Linux kind and image to the fabric nodes. Clients override these with a Linux image. A link lists exactly two endpoints, each written as `node:interface`.

Select `leaf2` to see its node definition, then follow its uplinks to both spines. Each leaf has one client connection and two fabric uplinks.

## Run it

Download the YAML and open it in a [connected app](../getting-started/index.md), then deploy. This lab requires a Linux host with enough resources for five SR Linux containers and three Linux clients. See [SR Linux requirements](https://containerlab.dev/manual/kinds/srl/) before deploying.

The file contains no routing or client IP configuration. It is a starting point for experimenting with your own underlay and overlay. For a ready-to-ping example, try the [Linux playground](linux.md).
