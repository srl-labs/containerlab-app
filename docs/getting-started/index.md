---
description: Pick the VS Code extension, the desktop app, the web app, or the browser sandbox.
---

# Choose an app

The editor, the explorer, and the lab tools are the same in every app. What differs is where your files live and which machine runs the labs.
{ .lead }

<div class="grid cards" markdown>

-   :material-microsoft-visual-studio-code: **VS Code extension**

    ---

    Your labs sit next to your code. The extension runs containerlab on the machine where VS Code runs: your Linux box, WSL, or a server over Remote SSH.

    **Needs:** containerlab and Docker on that machine.

    [Install the extension :lucide-arrow-right:](../install/vscode.md)

-   :lucide-monitor: **Desktop app**

    ---

    A standalone window for Linux, macOS, and Windows. It signs in to one or more lab hosts.

    **Needs:** `clab-api-server` on each lab host.

    [Install the desktop app :lucide-arrow-right:](../install/desktop.md)

-   :lucide-globe: **Web app**

    ---

    One container that serves the app to every browser on your team. Same sign-in as the desktop app.

    **Needs:** `clab-api-server` on each lab host, and Docker to run the web app.

    [Run the web app :lucide-arrow-right:](../install/web.md)

-   :lucide-flask-conical: **Browser sandbox**

    ---

    Draw and edit topologies with nothing installed. Files stay in your browser. It cannot deploy labs.

    **Needs:** nothing.

    [Open the sandbox :lucide-arrow-up-right:](https://srl-labs.github.io/containerlab-app/)

</div>

## Where things live

| | Your topology files | Your running labs |
| --- | --- | --- |
| VS Code | The folder you opened | The machine running the extension |
| Desktop and web | Your home directory on the lab host | The lab host running `clab-api-server` |
| Sandbox | Browser storage | Nowhere: design only |

Not sure? Start in the [sandbox](https://srl-labs.github.io/containerlab-app/) to get a feel for the editor. If you already use VS Code on Linux, the extension is the fastest way to a running lab. If several people share one lab server, run the web app.

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](first-lab.md)
[:lucide-arrow-right: How the apps reach a lab host](how-it-works.md)
</div>
