---
description: Deploy two Linux containers, connect them with one link, and ping across it.
---

# Quick start

Two Linux containers, one link, a ping across it. No network OS image to download and no license to configure.
{ .lead }

You need one of the apps [installed](index.md) and connected to a Linux machine with Docker. To only look around, the [browser sandbox](https://srl-labs.github.io/containerlab-app/) is enough for steps 1 and 2.

```clab file="examples/linux.clab.yml" annotations="examples/linux.clab.yml.annotations.json" title="Your first lab" view="split" height="360"
```

Click a node to see its definition. **Show in YAML** jumps to its lines in the file. The `exec` commands give each container an address on `eth1` when it starts.

<div class="steps" markdown>

1. **Get the file.** Use **Download YAML** above and save it as `linux.clab.yml`.

2. **Open it in your app.**

    === "VS Code"

        Put the file in the folder you have open. Select the containerlab icon in the Activity Bar. The lab shows up under undeployed labs; open it in the topology editor.

    === "Desktop or web"

        Open **Files** in the left rail and upload the file to your workspace: on this computer, or on the lab host. Then open it.

    === "Sandbox"

        Open the [sandbox](https://srl-labs.github.io/containerlab-app/) and import the file. You can edit and arrange it, but not deploy it.

3. **Deploy.** Select the green play button in the editor toolbar. Each node shows a status badge once its container is up.

4. **Ping across the link.** Right-click `client`, choose **Shell**, and run:

    ```sh
    ping -c 3 10.10.10.2
    ```

5. **Change it.** Add a third node from the palette, connect it, and watch the YAML update. When you are done, open the arrow next to the play button and choose **Destroy**. Your file stays; only the containers go away.

</div>

<div class="next" markdown>
[:lucide-arrow-right: Build a topology](../guides/topologies.md)
[:lucide-arrow-right: Run a lab](../guides/labs.md)
[:lucide-arrow-right: Explore a leaf–spine fabric](../examples/fabric.md)
</div>
