# Linux playground

One link is all you need to start exploring interfaces, addressing, and packet captures. The `exec` commands assign addresses when the nodes start.

```clab file="examples/linux.clab.yml" annotations="examples/linux.clab.yml.annotations.json" title="Two nodes. One connection." view="split" height="360"
```

## Try it

Download the topology, deploy it from your app, and open a shell on `client`:

```sh
ping -c 3 10.10.10.2
```

Use the app's packet capture action on `client:eth1` to inspect the ICMP exchange. Then experiment with the [troubleshooting tools](../manual/gui/index.md) and see how loss or delay changes the result.

Follow the [first lab walkthrough](../getting-started/first-lab.md) for the full setup.
