---
description: Deploy, apply changes, redeploy, and destroy labs, run them with containerlab options, and manage images.
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

Destroying only some nodes keeps the rest running, so it cannot be combined with clean up. In VS Code these flags come after `deploy.extraArgs` and `destroy.extraArgs`. The desktop and web apps do not accept an absolute path for the export template.

## Images

**Manage Images**, in the header of the explorer's running labs section, lists the images your labs and templates use, pulls missing ones, and removes those you no longer need.

![Image manager](../images/app/image-manager-dark.webp#only-dark){ .shot }
![Image manager](../images/app/image-manager-light.webp#only-light){ .shot }

<div class="next" markdown>
[:lucide-arrow-right: Troubleshoot a running lab](troubleshooting.md)
[:lucide-arrow-right: Shared labs](shared-labs.md)
</div>
