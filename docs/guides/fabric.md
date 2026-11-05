# Fabric view

The Fabric view shows what an SR Linux lab looks like, what is wrong with it, and what changed. It reads the nodes over gNMI, read-only, with [fcling](https://github.com/srl-labs/fcling).

Right-click a running lab in the explorer and pick **Tools > Open Fabric View**. It works in VS Code, the desktop app, and the web app. The entry shows on labs with at least one SR Linux node.

## What you can see

| View | What it shows |
| --- | --- |
| **Topology** | The fabric by tier, with each node's health and each cable's state. Click one for its details. |
| **Nodes** | Whether each node is streaming, and since when. |
| **Incidents** | What is wrong, grouped by root cause, worst first, and what changed just before. Acknowledge the ones you know about. |
| **History** | Every change kept, with the configuration commit that likely caused it, and that commit's diff. |
| **Lenses** | **Where** finds an IP or MAC, **Path** traces a route hop by hop, **Service** compares a service across nodes, and **Endpoints** lists the attached hosts. |
| **Reports** | Any report as a table you can sort and filter, such as `bgp-peers`, `ipv4-rib` or `lldp`. |

Type a time in **Go back**, such as `30m`, `2h` or `14:02`, to see the fabric as it was then.

## What runs where

The view starts one container for the lab on the lab host, on the lab's management network. The first time, its image `ghcr.io/srl-labs/fcling` is pulled, which can take a minute.

- It keeps running when you close the view, so the history goes on. **Stop engine** in the view's menu stops it and keeps the history for the next start.
- Destroying the lab from the app removes the container and its history. Redeploying removes the container and keeps the history; start it again from the view.
- A plain `containerlab destroy` on the command line does not know about the container. It is removed the next time an engine starts on that host; on a lab host running `clab-api-server`, within five minutes.

Each node gives the container about 2 of its 20 gNMI sessions.

## Limits

- Only SR Linux nodes are read. They need gNMI on, and SR Linux's default credentials.
- It is not available on Kubernetes (c9s) lab hosts.
- A lab host running `clab-api-server` needs a version that lists `fcling` in its features. On an older one, update the server to use the view.

## Reports without the view

The explorer's **Run fcling** entries run one report in a throwaway container and show its output. They do not start anything that stays running.

<div class="next" markdown>
[:lucide-arrow-right: Run a lab](labs.md)
[:lucide-arrow-right: Troubleshoot](troubleshooting.md)
</div>
