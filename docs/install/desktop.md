---
description: Install the containerlab desktop app on Linux, macOS, or Windows.
---

# Desktop app

A native window for Linux, macOS, and Windows. On Linux it runs labs on the computer itself, like the VS Code extension. It can also sign in to `clab-api-server` on lab hosts, and shows all of them side by side.
{ .lead }

## Install

Download the package for your system from the [latest release](https://github.com/srl-labs/containerlab-app/releases).

=== "Debian / Ubuntu"

    ```bash
    sudo apt install ./containerlab-desktop-<version>-amd64.deb
    ```

=== "Fedora / RHEL"

    ```bash
    sudo dnf install ./containerlab-desktop-<version>-x86_64.rpm
    ```

=== "Other Linux"

    ```bash
    chmod +x ./containerlab-desktop-<version>-x86_64.AppImage
    ./containerlab-desktop-<version>-x86_64.AppImage
    ```

=== "macOS"

    Open `containerlab-desktop-<version>-universal.dmg` and drag the app to Applications.

=== "Windows"

    Run `containerlab-desktop-<version>-x64-setup.exe`.

The macOS and Windows builds are not signed yet, so the system may warn you the first time you open them.

## Run labs on this computer

On Linux, the app runs labs with the containerlab CLI and Docker of the computer it runs on. No API server, no sign-in: the app opens on the labs of **This computer**.

<div class="steps" markdown>

1. **Prepare the computer** as for the [VS Code extension](vscode.md#prepare-the-lab-machine): install containerlab, make sure Docker works, and add your user to the `clab_admins` and `docker` groups. Log in again after changing groups.

2. **Start the app.** The explorer shows **This computer** with its running and undeployed labs.

</div>

When something is missing, the app opens on a start screen instead. It lists what to fix, with the command for each, for example the `usermod` line for a missing group. Fix it and select **Check Again**; the app opens on your labs once containerlab is ready. It never asks for your sudo password.

![This computer is not ready yet](../images/app/desktop-setup-dark.webp#only-dark){ .shot .narrow }
![This computer is not ready yet](../images/app/desktop-setup-light.webp#only-light){ .shot .narrow }

Labs on this computer run as your user. Topologies live in `~/.clab`, the same folder `clab-api-server` uses, and so do node templates and icons; a lab host on the same machine sees the same files.

To hide **This computer**, remove it under **Settings** > **Lab hosts**. It stays hidden until you select **Use This Computer** there.

To change how the app runs containerlab, create `~/.config/Containerlab/local-backend.json`:

```json
{
  "binaryPath": "/usr/local/bin/containerlab",
  "runtime": "docker",
  "dockerSocketPath": "/var/run/docker.sock",
  "workspaceRoot": "/home/alice/labs",
  "deployExtraArgs": ["--max-workers", "4"]
}
```

Set `"enabled": false` to turn **This computer** off entirely, or `"sudo": true` to run containerlab with `sudo -n`, which needs passwordless sudo. The same options are available as [environment variables](../reference/app-settings.md#desktop-app).

## Work with lab hosts

To work with labs on other machines, or from macOS and Windows, set up a [lab host](lab-host.md) and [sign in to it](sign-in.md). On Linux, add lab hosts under **Settings** > **Lab hosts**; their labs show up next to **This computer**. On macOS and Windows the app starts on the sign-in screen.

## Options

The app reads a few environment variables at start, for example to preset the API URL for a team. See [web and desktop settings](../reference/app-settings.md#desktop-app).

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
[:lucide-arrow-right: Sign in to a lab host](sign-in.md)
</div>
