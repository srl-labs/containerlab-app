---
description: Install the containerlab desktop app on Linux, macOS, or Windows.
---

# Desktop app

A native window for Linux, macOS, and Windows. It runs nothing locally: it signs in to `clab-api-server` on your lab hosts.
{ .lead }

Set up a [lab host](lab-host.md) first.

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

Start the app and [sign in to your lab host](sign-in.md). If the API server runs on the same Linux machine, the URL is `https://localhost:8090`.

On macOS and Windows, labs still run on Linux: point the app at the API server in your Linux VM or on a remote server.

## Options

The app reads a few environment variables at start, for example to preset the API URL for a team. See [web and desktop settings](../reference/app-settings.md#desktop-app).

<div class="next" markdown>
[:lucide-arrow-right: Sign in to a lab host](sign-in.md)
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
</div>
