---
description: Choose Containerlab for VS Code, desktop, or the browser.
---

# Your workspace, your way

Three ways in. The same topology editor, lab explorer, and troubleshooting tools once you're there.

<div class="grid cards" markdown>

-   :material-microsoft-visual-studio-code: **VS Code**

    ---

    Keep labs next to your code. Work locally on Linux, in WSL, or on a host through Remote SSH.

    [Install the extension →](../manual/gui/vsc-extension.md)

-   :lucide-monitor: **Desktop**

    ---

    A dedicated app for Linux, macOS, and Windows. Connect to the API on your Linux lab host.

    [Get the desktop app →](../manual/gui/desktop.md)

-   :lucide-globe: **Web**

    ---

    Run the app on a server and reach your labs from a browser. Connect multiple lab hosts in one workspace.

    [Run the web app →](../manual/gui/web.md)

</div>

## Just exploring?

[Open the browser sandbox](https://srl-labs.github.io/containerlab-app/){ .md-button .md-button--primary }

The sandbox lets you design and visualize topologies without an installation. Its files stay in browser storage. To deploy labs and interact with devices, use an app connected to a Linux lab host.

## What runs where?

| Environment | Where your files live | Where your labs run |
| --- | --- | --- |
| VS Code | The workspace you opened | The Linux environment running the extension |
| Web / desktop | Your user directory on the API host | The Linux host running `clab-api-server` |
| Browser sandbox | Your browser's local storage | Design only |

For web and desktop, [connect a lab host](../manual/api-server.md) before deploying. For VS Code, install containerlab and Docker in the Linux environment where the extension runs.

Next: [build your first lab](first-lab.md).
