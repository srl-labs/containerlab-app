---
description: Pick the VS Code extension, the desktop app, the web app, or the browser sandbox.
---

# Choose an app

The editor, the explorer, and the lab tools are the same in every app. What differs is where your files live and which machine runs the labs.
{ .lead }

<div class="grid cards" markdown>

-   :material-microsoft-visual-studio-code: **VS Code extension**

    ---

    Your labs sit next to your code. The extension runs containerlab on the machine where VS Code runs: your Linux box, WSL, or a server over Remote SSH. It can show the labs of lab hosts next to them.

    **Needs:** containerlab and Docker on that machine, or a lab host.

    [Install the extension :lucide-arrow-right:](../install/vscode.md)

-   :lucide-monitor: **Desktop app**

    ---

    A standalone window for Linux, macOS, and Windows. On Linux it runs labs on the computer itself, like VS Code; it can also sign in to lab hosts.

    **Needs:** containerlab and Docker on Linux, or a lab host.

    [Install the desktop app :lucide-arrow-right:](../install/desktop.md)

-   :lucide-globe: **Web app**

    ---

    One container that serves the app to every browser on your team. It signs in to lab hosts, or runs labs on its own host when you turn that on.

    **Needs:** Docker to run the web app, and a lab host or containerlab on the web app's host.

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
| Desktop app on Linux | `~/.clab` on your computer | Your computer |
| Any app with a lab host | Your home directory on the lab host | The lab host running `clab-api-server` |
| Sandbox | Browser storage | Nowhere: design only |

Not sure? Start in the [sandbox](https://srl-labs.github.io/containerlab-app/) to get a feel for the editor. On a Linux machine with containerlab, the VS Code extension and the desktop app run labs right away, with nothing else to set up. To work with labs on another machine, from macOS or Windows, or with several people on one server, set up a [lab host](../install/lab-host.md).

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](first-lab.md)
[:lucide-arrow-right: How the apps reach a lab host](how-it-works.md)
</div>
