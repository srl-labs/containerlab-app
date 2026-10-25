---
description: Deploy, apply changes, redeploy, and destroy labs, validate and share them, run them with containerlab options, and manage images.
---

# Run a lab

The green play button and the arrow next to it hold every lifecycle action. They run on the machine behind your app: the VS Code host, or the lab host you signed in to.
{ .lead }

## Deploy and apply

The play button is **Apply**. It does the right thing for the lab's state:

| The lab is… | Apply… |
| --- | --- |
| Not running | Deploys it. |
| Running, file unchanged | Nothing to do; the button is disabled. |
| Running, file changed | Shows a plan first, then runs `containerlab apply` to bring the running lab in line with the file. A dot on the button tells you there are changes. |

### Check the plan before applying

For a running lab, Apply first runs `containerlab apply --dry-run` and lists what would happen: nodes to create, start, restart, recreate, or remove, and links to connect or disconnect. Restarts and recreates come with containerlab's reason, for example `config drift: image`. Nothing changes until you select **Apply**.

- Recreated and removed nodes lose configuration you did not save, so the dialog warns you about them.
- If the running lab already matches the file, the dialog says there is nothing to apply.
- If the dry run fails, the dialog shows the error, and you can still choose **Apply anyway**.

When a lab is running, its nodes show a status badge, and right-clicking a node gives you its [runtime actions](troubleshooting.md).

![A running lab with a node's actions open](../images/app/running-lab-dark.webp#only-dark){ .shot }
![A running lab with a node's actions open](../images/app/running-lab-light.webp#only-light){ .shot }

## The lifecycle menu

The arrow next to the play button opens the rest:

| Action | What happens |
| --- | --- |
| **Deploy (cleanup)** | Deploy after removing leftovers of an earlier run. |
| **Redeploy** | Destroy and deploy again. Node changes you did not save are lost. |
| **Redeploy (cleanup)** | The same, and remove the lab directory first. |
| **Destroy** | Remove the containers and links. Your files stay. |
| **Destroy (cleanup)** | Also remove the lab directory with generated configs and certificates. |
| **Start Nodes**, **Stop Nodes**, **Restart Nodes** | Start, stop, or restart the containers without redeploying. |
| **Run Command…**, **Save Configs…**, **Save VM Snapshots…**, **Inspect Details** | Work with the running lab; see [Lab operations](#lab-operations). |
| **Validate** | Run `containerlab validate` on the topology file without deploying it. |
| **Run with options…** | Any of the above with extra containerlab flags. |

In VS Code, cleanup actions ask for confirmation unless `containerlab.skipCleanupWarning` is on.

## Run with options

**Run with options…** deploys, redeploys, or destroys with flags you pick for this run only. The dialog shows the resulting `containerlab` command as you go.

![Run with options](../images/app/lifecycle-options-dark.webp#only-dark){ .shot .narrow }
![Run with options](../images/app/lifecycle-options-light.webp#only-light){ .shot .narrow }

| Option | Deploy | Redeploy | Destroy | Flag |
| --- | :---: | :---: | :---: | --- |
| Clean up | ✓ | ✓ | ✓ | `-c` |
| Nodes | ✓ | | ✓ | `--node-filter` |
| Graceful shutdown | | ✓ | ✓ | `--graceful` |
| Keep management network | | ✓ | ✓ | `--keep-mgmt-net` |
| Skip post-deploy actions | ✓ | ✓ | | `--skip-post-deploy` |
| Skip lab directory ACLs | ✓ | ✓ | | `--skip-labdir-acl` |
| Max workers | ✓ | ✓ | | `--max-workers` |
| Export template | ✓ | ✓ | | `--export-template` |
| Template variables file | ✓ | ✓ | ✓ | `--vars` |
| Restore VM snapshots | ✓ | | | `--restore-all`, `--restore` |

The template variables file is relative to the topology file. Leave it empty to use `<topology>_vars.yml` next to the topology, as containerlab does. Destroy and redeploy need the same file as the deploy when the template depends on it. On a lab host, `--vars` needs a clab-api-server with template support; older servers ignore it.

Destroying only some nodes keeps the rest running, so it cannot be combined with clean up. In VS Code these flags come after `deploy.extraArgs` and `destroy.extraArgs`. The desktop and web apps do not accept an absolute path for the export template.

**Restore VM snapshots** boots vrnetlab nodes from snapshots saved with **Save VM Snapshots…**: every node with a `<node>.tar` in the snapshot directory starts from it, and a node snapshot file you add wins for its node. Relative paths start at the topology file's folder. containerlab 0.72 or later is needed.

## Lab operations

These entries of the lifecycle menu, and of a node's right-click menu, work on a running lab. Select several nodes with Shift-click first to act on all of them at once: **Start**, **Stop**, and **Restart** then make one `containerlab start|stop|restart --node a,b` call.

| Action | containerlab | What happens |
| --- | --- | --- |
| **Run Command…** | `exec` | Runs one command on the chosen nodes, on all nodes, or on the nodes that carry every given `key=value` label, and shows each node's output and exit code. |
| **Save Configs…** | `save` | Saves the running configs. **Copy the saved configs to a directory** also keeps timestamped copies under `<directory>/clab-<lab>/<node>/`, with the newest linked under the original name. |
| **Save VM Snapshots…** | `tools snapshot save` | Saves the VM state of vrnetlab nodes as `<node>.tar`; other nodes are skipped. |
| **Inspect Details** | `inspect --details` | Shows everything the container runtime reports for each node. |

Paths are relative to the topology file's folder. On a lab host they must stay in your lab workspace.

The explorer's **Save Configs To…** saves a deployed lab's configs with a copy, too.

A lab host hides what it cannot do. Copying saved configs needs containerlab 0.73 and VM snapshots 0.72; on a lab host, running by label, snapshots, copies, details, snapshot restore and one-call multi-node actions need a clab-api-server that lists them in `/health`. Older lab hosts still run commands and start, stop, or restart several nodes, one node at a time.

## Validate a topology

**Validate** in the lifecycle menu, and **Validate Topology** on a lab in the explorer, check the topology file the way `containerlab validate` does: the schema, the nodes, and the links. A valid topology reports its node and link count. Otherwise you get containerlab's error. In VS Code, **Validate Topology** is also in the context menu of `.clab.yml` files.

## Share a running lab

The **Sharing** actions of a running lab start a terminal others can join in the browser.

| Tool | Options when you share |
| --- | --- |
| **SSHX** | Also create a read-only link: viewers watch the terminals but cannot type. |
| **GoTTY** | The port, a username and password instead of `admin`/`admin`, and the shell. |

The app shows the links to copy or open. Labs on a lab host need a clab-api-server that offers these options; with an older one, sharing works with the defaults and the dialog says what is missing.

## Images

**Manage Images**, in the header of the explorer's running labs section, lists the images your labs and templates use, pulls missing ones, and removes those you no longer need.

![Image manager](../images/app/image-manager-dark.webp#only-dark){ .shot }
![Image manager](../images/app/image-manager-light.webp#only-light){ .shot }

<div class="next" markdown>
[:lucide-arrow-right: Troubleshoot a running lab](troubleshooting.md)
[:lucide-arrow-right: Shared labs](shared-labs.md)
</div>
