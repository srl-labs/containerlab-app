---
description: Install the containerlab desktop app on Linux, macOS, or Windows.
---

# Desktop app

A native window for Linux, macOS, and Windows. It signs in to `clab-api-server` on your lab hosts, and on Linux it can also run labs on the computer itself.
{ .lead }

For labs on other machines, set up a [lab host](lab-host.md) first.

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

## Connect

Start the app and [sign in to your lab host](sign-in.md). If the API server runs on the same Linux machine, the URL is `https://localhost:8090`, or use this computer directly, as described next.

On macOS and Windows, labs still run on Linux: point the app at the API server in your Linux VM or on a remote server.

## Run labs on this computer

On Linux, the app can run labs itself, with the containerlab CLI and Docker of the computer it runs on. No API server, no sign-in.

<div class="steps" markdown>

1. **Prepare the computer** as for the [VS Code extension](vscode.md#prepare-the-lab-machine): install containerlab, make sure Docker works, and add your user to the `clab_admins` and `docker` groups. Log in again after changing groups.

2. **Select Use This Computer** on the sign-in screen, or add it later from the endpoint settings. It shows up as **This computer** next to your lab hosts.

</div>

When something is missing, the button stays disabled and the app lists what to fix, for example the `usermod` line for a missing group. It never asks for your sudo password.

Labs on this computer run as your user. Topologies live in `~/.clab`, the same folder `clab-api-server` uses, and so do node templates and icons; a lab host on the same machine sees the same files.

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

Set `"enabled": false` to hide **This computer**, or `"sudo": true` to run containerlab with `sudo -n`, which needs passwordless sudo. The same options are available as [environment variables](../reference/app-settings.md#desktop-app).

## Options

The app reads a few environment variables at start, for example to preset the API URL for a team. See [web and desktop settings](../reference/app-settings.md#desktop-app).

<div class="next" markdown>
[:lucide-arrow-right: Sign in to a lab host](sign-in.md)
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
</div>
