---
description: Sign the desktop or web app in to one or more lab hosts running clab-api-server.
---

# Sign in to a lab host

Sign in once per lab host and the explorer shows all of them side by side, next to the labs of the computer itself where the app runs them.
{ .lead }

You need a lab host running [`clab-api-server`](lab-host.md), and a Linux account on it that is in the `clab_api` or `clab_admins` group. The [VS Code extension](vscode.md#work-with-labs-on-a-lab-host) signs in the same way.

## Sign in

The web app, and the desktop app on macOS and Windows, start on **Sign in to a lab host**. On Linux the desktop app starts on the labs of [this computer](desktop.md#run-labs-on-this-computer); add lab hosts under **Settings** > **Lab hosts**.

![Sign in to a lab host](../images/app/sign-in-dark.webp#only-dark){ .shot .narrow }
![Sign in to a lab host](../images/app/sign-in-light.webp#only-light){ .shot .narrow }

| Field | Fill in |
| --- | --- |
| **Lab host URL** | The API Server URL, for example `https://lab1.example.com:8090` |
| **Name** | A short name for the explorer, for example `lab1`. Defaults to the host name |
| **Username**, **Password** | Your Linux account on the lab host |
| **Stay signed in for** | How long the session lasts: `24h`, `7d`, `1h30m` |

The password goes to the API Server once, in exchange for a session token. The app keeps the token, not the password.

## Several lab hosts

Add more under **Settings** > **Lab hosts**. Each one keeps its own session, so you can, say, work on a shared lab host and your own VM at the same time. The same page shows each host's status, CPU, memory, and disk, and lets you edit, sign in again, or remove it.

- The explorer groups labs and files by lab host.
- An action runs on the lab host that owns the lab or file. When that is unclear, the app asks.
- Node templates are stored per lab host and per user, under `~/.clab` on the lab host. Templates you create on `lab1` stay on `lab1`.

## Move lab hosts to another machine

Under **Lab host profiles**, **Export** your list of lab hosts and **Import** it in another desktop app or browser. The export contains URLs, names, usernames, and session durations. It never contains passwords or tokens, so you sign in to each lab host again after importing.

## If sign-in fails

<div class="steps" markdown>

1. **Is the API Server reachable from where the app runs?** For the web app, that is the web app's container, not your browser.

    ```bash
    curl -k https://lab1.example.com:8090/health
    ```

2. **Is the service running?**

    ```bash
    sudo systemctl status clab-api-server
    ```

3. **Is your user allowed?** It must exist on the lab host and be in `clab_api` or `clab_admins`. Group changes apply to new sign-ins.

    ```bash
    id alice
    ```

</div>

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
[:lucide-arrow-right: Tour the workspace](../guides/workspace.md)
</div>
