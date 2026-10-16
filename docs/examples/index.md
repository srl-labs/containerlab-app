---
description: Example containerlab topologies you can explore here and download.
---

# Examples

Each example is a real `.clab.yml` file. Look around, then download it and deploy it from your app.
{ .lead }

<div class="pair" markdown>
<div markdown>

Linux playground

```clab file="examples/linux.clab.yml" annotations="examples/linux.clab.yml.annotations.json" title="Linux playground preview" height="240" borderless="true" zoom="false" pan="false" fit-padding="0.3"
```

Two Linux nodes with addresses, ready to ping. Runs anywhere. [Open the example :lucide-arrow-right:](linux.md)

</div>
<div markdown>

Leaf–spine fabric

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric preview" height="240" borderless="true" zoom="false" pan="false" fit-padding="0.12"
```

Two spines, three leaves, three clients on SR Linux. Wiring only. [Open the example :lucide-arrow-right:](fabric.md)

</div>
<div markdown>

Packet walk

```clab file="examples/packet-walk.clab.yml" annotations="examples/packet-walk.clab.yml.annotations.json" title="Packet walk preview" height="240" borderless="true" theme="light" transparent="false" zoom="false" pan="false" fit-padding="0.08"
```

Client, router, server across two subnets, with addresses and routes. [Open the example :lucide-arrow-right:](../viewer/customize.md#packet-walk)

</div>
<div markdown>

Branch office

```clab file="examples/branch-office.clab.yml" annotations="examples/branch-office.clab.yml.annotations.json" title="Branch office preview" height="240" borderless="true" theme="light" transparent="false" zoom="false" pan="false" fit-padding="0.08"
```

Two uplinks, a redundant core, three floors. Wiring only. [Open the example :lucide-arrow-right:](../viewer/customize.md#branch-office)

</div>
</div>

More styled labs, with their annotation files, are in the [customization studio](../viewer/customize.md#collection). For routing protocols, network operating systems, and bigger labs, see the [containerlab lab examples](https://containerlab.dev/lab-examples/lab-examples/).
