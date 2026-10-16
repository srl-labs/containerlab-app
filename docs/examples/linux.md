---
description: Two Linux containers, one link, addresses ready to ping.
---

# Linux playground

The smallest useful lab: two Linux containers with the usual network tools, and one link. No network OS image, no license, runs on any Docker host.
{ .lead }

```clab file="examples/linux.clab.yml" annotations="examples/linux.clab.yml.annotations.json" title="Two nodes. One connection." view="split" height="360"
```

The `exec` lines give `client` the address `10.10.10.1/24` and `server` `10.10.10.2/24` on `eth1` when the containers start.

## Try it

<div class="steps" markdown>

1. **Deploy** the downloaded file from your app.

2. **Ping** from a shell on `client`:

    ```sh
    ping -c 3 10.10.10.2
    ```

3. **Watch the packets.** Right-click the link and choose **Capture**.

4. **Break it a little.** Add 200 ms of delay with [Link Impairments](../guides/troubleshooting.md#impair-a-link) and ping again.

</div>
