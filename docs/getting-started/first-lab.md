# A network in a few minutes

Start small: two Linux containers and one link. No network OS image to obtain, no device license to configure. This example assigns an address to each end so you can test the connection immediately.

## 1. Explore the lab

Click a node to inspect it, then select **Show in YAML** to reveal its configuration. The two tabs are views of the same file.

```clab file="examples/linux.clab.yml" annotations="examples/linux.clab.yml.annotations.json" title="Your first connection" height="340"
```

## 2. Open it in your app

Use the example's **Download YAML** button and save `linux.clab.yml`.

=== "VS Code"

    Open a folder containing the file. Select the Containerlab icon in the Activity Bar, find the lab, and open its topology viewer. The extension needs containerlab and Docker on its Linux host.

=== "Web or desktop"

    Connect to your API endpoint. Upload the topology file through the Explorer, then open it in the topology editor. Files are saved on the API host for the Linux user you logged in as.

=== "Browser sandbox"

    Open the [sandbox](https://srl-labs.github.io/containerlab-app/) and import the YAML to explore and edit it. Move the file to a connected app when you're ready to deploy.

## 3. Deploy and test

Use **Deploy** on the lab. After the containers start, open a shell on `client` and run:

```sh
ping -c 3 10.10.10.2
```

The addresses come from the `exec` commands in the YAML. The `eth1` interfaces come from its `links` section. Your diagram, topology file, and running network describe the same connection.

## 4. Make it yours

Add another node on the canvas, connect it to the network, and inspect the resulting YAML. When you're finished, use **Destroy** to remove the running lab containers.

Continue with the [topology design guide](../guides/topologies.md), or explore a [leaf–spine fabric](../examples/fabric.md).
