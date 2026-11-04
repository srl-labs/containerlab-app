# Script buttons

A script button is a button on the canvas that runs a shell script on the lab host. Use one for what you repeat while working with a lab: reset some state, start traffic, or collect output.

Add one from the palette (**Actions**) or with **Add Script Button** in the canvas context menu. Each button has a label, an icon, a color, an optional timeout, and either a script file or an inline script.

Buttons are stored in the lab's annotations file. **Anything in an inline script ends up wherever that file goes, so keep secrets out of it.**

## Where a script runs

Scripts run on the lab host, not in the lab's nodes. To reach a node, the script does what you would do in a shell, such as `docker exec` or `ssh`.

| Lab host | Runs on | Runs as | Default |
| --- | --- | --- | --- |
| Desktop app, this computer | This computer | Your OS user | On |
| VS Code, local | The machine the extension runs on | Your OS user | On |
| Web app with `WEB_LOCAL_LABS` | The web app's host, or its container | The server's OS user, for every visitor | Off, `WEB_LOCAL_HOST_SCRIPTS=true` turns it on |
| clab-api-server | The server's host, or its container | The signed-in Linux user | Off, `API_HOST_SCRIPTS=true` turns it on |
| Kubernetes (c9s) | Scripts do not run | | |

On a host that can't run scripts you can't add buttons, and buttons already in the file show as disabled, with the reason.

## How a script runs

- It runs with `bash`, from the topology folder, with `CLAB_LAB_NAME` and `CLAB_TOPOLOGY` set. The file's own `#!` line is not used, so run another language explicitly: `python3 collect.py`.
- It has no terminal and no input, so programs that ask for something fail. `sudo` works only without a password.
- A relative script path starts at the topology folder. On clab-api-server a script file must be inside your workspace or the shared folder.
- An inline script can have up to 100 KiB.

It does what its account can do. On clab-api-server that means a user who isn't in the `docker` or `clab_admins` group can't use `docker` or privileged `containerlab` commands, even if the same button works for someone else.

## Stopping a script

The run control turns into a stop control while a script runs. Closing its terminal pane stops it too, and so does closing the view in VS Code or the connection on web and desktop.

Stopping sends `SIGTERM` to the script and everything it started, then `SIGKILL` 5 seconds later. A timeout does the same. On clab-api-server a script stops after 24 hours at the latest, and each user can run 4 at a time.

A process the script leaves running when it exits normally keeps running, without its output. Redirect its output so that it doesn't stop when it next writes:

```bash
nohup iperf3 -s >/dev/null 2>&1 &
```

## Trust

A script runs with your account, and whoever wrote the lab wrote the script. **Read a script before you run it, as you would before running one from the internet.**

Before a script runs, the lab host describes it: the full path, the owner and the content. The dialog shows this before you agree, and the run is refused if the script changed in the meantime.

| Setting | Asks |
| --- | --- |
| **First run of each script** (default) | The first time for this exact content, on this host and topology. A changed script or file asks again. |
| **Every run** | Before every run. |
| **Only scripts from others** | Only for scripts you may not have written. |

Scripts you may not have written always ask, whatever the setting: another user's file or lab, or anything in a shared folder.

Web and desktop keep this setting under **Settings**, per browser. VS Code uses `containerlab.editor.scriptButtons.confirm`, which a workspace can't change.

## For administrators

A script button gives its user nothing they can't do already: anyone who can deploy a lab can run commands on the host as root, through `exec` with `target: host` in a node's `stages`. On clab-api-server, scripts are less powerful than that, because they run as the signed-in user. They are still off by default, so that nobody gets this through an upgrade.

With `API_HOST_SCRIPTS=true`:

- Accounts whose shell is `nologin` or `false` are refused.
- The server logs who started which script on which lab, with its path or hash, and how it ended.
- Scripts get a minimal environment, without the server's settings.

Running clab-api-server as a container, scripts see the container's files and `/home`, not the host's tools.
