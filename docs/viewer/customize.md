# Make the viewer your own

Start with the full component or a borderless canvas, then choose each panel and interaction independently. These examples render the same saved topology with different presentations.

## A diagram in the page

A transparent canvas blends into the document. Disable wheel zoom when readers should scroll straight past it; keep zoom and fit buttons available.

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Inline fabric" borderless="true" controls="true" zoom="false" height="340" fit-padding="0.15"
```

````markdown
```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" borderless="true" controls="true" zoom="false" height="340" fit-padding="0.15"
```
````

## Keep only what readers need

Keep the Topology/YAML tabs and download actions, with no frame, title, inspector, or footer. Borderless does not prevent using a split view or bringing individual controls back.

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Minimal split view" borderless="true" toolbar="true" view="split" height="360"
```

````markdown
```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" borderless="true" toolbar="true" view="split" height="360"
```
````

## A fixed theme and visible interfaces

Pin the viewer to a light theme, choose a line grid, and reveal interface names only when a link is selected. The site's theme can change independently.

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Inspect the connections" theme="light" grid="lines" link-labels="on-select" heading="false" footer="false" height="380"
```

````markdown
```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" theme="light" grid="lines" link-labels="on-select" heading="false" footer="false" height="380"
```
````

See the [component reference](reference.md) for every option, CSS color and sizing tokens, and the iframe and React APIs.
