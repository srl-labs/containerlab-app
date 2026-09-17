# Containerlab Apps

Build, run, and explore your [containerlab](https://containerlab.dev/) network labs in **VS Code**, **a web browser**, or **a desktop app**. Create topologies visually, work with your existing lab files, and go from a network diagram to running devices you can inspect and troubleshoot.

All three apps share the same topology editor, so you can choose the environment that fits how you work.

[![Docs](https://img.shields.io/badge/Docs-containerlab.dev-blue?style=flat-square&color=00c9ff&labelColor=bec8d2)](https://containerlab.dev/)
[![Bluesky](https://img.shields.io/badge/follow-containerlab-1DA1F2?logo=bluesky&style=flat-square&color=00c9ff&labelColor=bec8d2)](https://bsky.app/profile/containerlab.dev)
[![Discord](https://img.shields.io/discord/860500297297821756?style=flat-square&label=discord&logo=discord&color=00c9ff&labelColor=bec8d2)](https://discord.gg/vAyddtaEV9)

![The shared Containerlab interface with the lab explorer and visual topology editor](apps/web/resources/screenshot.png)

## Choose your app

| App | How you work | Get started |
| --- | --- | --- |
| **VS Code** | Edit topology files and manage labs alongside your code, locally on Linux or through WSL or Remote SSH. | [Install the extension](#vs-code-extension) |
| **Web** | Open your lab environment in a browser, with the app hosted on a server or VM. | [Run the web app](#web-app) |
| **Desktop** | Use a dedicated application on Linux, macOS, or Windows to connect to your lab hosts. | [Download the desktop app](#desktop-app) |

> [!TIP]
> [Try the browser sandbox](https://srl-labs.github.io/containerlab-app/) without installing anything. You can edit and visualize topologies, with your workspace saved in browser storage. Deploying and interacting with real labs requires one of the apps below.

## From topology to running lab

Start with an existing `.clab.yml` or `.clab.yaml` file, or create a new topology in the visual editor. Add nodes and links, arrange your network, and use the lab tools to bring it to life:

- **Design your network:** edit topologies on the canvas or in YAML, with groups and annotations to explain the layout.
- **Manage your labs:** deploy, destroy, and redeploy labs, and follow their status as it changes.
- **Work with your devices:** open terminals and SSH sessions, inspect containers, and view logs.
- **Troubleshoot traffic:** capture packets with Wireshark and test how your network behaves with delay, loss, and other link impairments.

## VS Code extension

Keep your topology files, device configurations, and running labs together in your editor. The Containerlab extension discovers labs in your workspace and gives you a lab explorer, the visual topology editor, and lab and device actions directly in VS Code.

1. Install **Containerlab** from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=srl-labs.vscode-containerlab) or [Open VSX](https://open-vsx.org/extension/srl-labs/vscode-containerlab).
2. Open a folder containing your topology files, or clone a lab from the extension's welcome page.
3. Select the **Containerlab** icon in the Activity Bar to find your labs.
4. Open a lab in the topology viewer, or right-click a lab or device for actions such as **Deploy**, **Destroy**, and opening a shell.

The extension runs containerlab directly in a Linux environment. On Windows, use WSL.

> [!TIP]
> Your editor and your labs can run on different machines. Connect to a Linux lab host with VS Code Remote SSH and install the Containerlab extension there. You can use this setup from Linux, macOS, or Windows.

The extension can help install containerlab and set up the required `clab_admins` group membership. With Docker, your user also needs access through the `docker` group.

See the [extension guide](apps/vscode-containerlab/README.md) for settings, packet capture setup, and more ways to work with labs.

## Web app

Access your labs from a browser, with the same topology editor and lab tools available on any workstation that can reach the web app. You can connect to multiple lab hosts from one installation.

First, [set up access to your lab host](#connect-the-web-and-desktop-apps-to-your-lab-host). Then run the web app on a Linux server or VM with Docker:

```bash
docker run -d --name containerlab-app \
  --restart unless-stopped \
  --network host \
  ghcr.io/srl-labs/containerlab-web:latest
```

Open **`https://<web-app-host>:3001`**, or **`https://localhost:3001`** when browsing on that host. The app generates a self-signed HTTPS certificate by default, so your browser may ask you to accept it.

At login, enter the API URL for your lab host and its Linux username and password. If the API server runs on the same host as the web app, use `https://localhost:8090`. Otherwise, use an address such as `https://lab-host.example.com:8090`.

> [!NOTE]
> In the web app's API address, `localhost` refers to the server running the web app. A remote API address must be reachable from that server, even when you open the app in a browser on another machine.

The container image supports Linux AMD64 and ARM64. Certificate and port options are listed under [configuration](#configuration).

## Desktop app

Use the Containerlab interface in its own application window on your workstation. The desktop app connects to your lab hosts over the API, so your labs can run on another machine while you work from Linux, macOS, or Windows.

Download a package from the [latest desktop release](https://github.com/srl-labs/containerlab-app/releases/latest):

| Platform | Package | Installation |
| --- | --- | --- |
| Debian / Ubuntu | `.deb` | Install with your package manager. |
| Fedora / RHEL | `.rpm` | Install with your package manager. |
| Other Linux | AppImage | Make the file executable, then run it. |
| macOS | Universal `.dmg` | Open the disk image and move Containerlab to Applications. |
| Windows | `.exe` installer | Run the installer. |

[Set up access to your lab host](#connect-the-web-and-desktop-apps-to-your-lab-host), launch the app, and enter the API URL and your Linux credentials for that host. For a remote host, use an address such as `https://lab-host.example.com:8090`.

> [!NOTE]
> The macOS and Windows packages are currently unsigned, so Gatekeeper or SmartScreen may show a warning when you open them.

## Connect the web and desktop apps to your lab host

The web and desktop apps connect to `clab-api-server`, which manages labs on a Linux host with your container runtime. That host can be your Linux workstation, a VM, or a remote server. On macOS and Windows, run the API server in the Linux environment where your labs run.

If your lab host already has an API server, you only need its URL and an allowed Linux account. To set one up, run these commands on the lab host:

```bash
curl -fsSL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo bash -s -- install
sudoedit /etc/clab-api-server/clab-api-server.env
sudo usermod -aG clab_api <username>
sudo systemctl enable --now clab-api-server
```

Replace `<username>` with an existing Linux user on that host. Sign in to the app with that user's Linux password. By default, members of `clab_api` can sign in, and members of `clab_admins` have elevated permissions.

The API server uses HTTPS on port `8090` by default. See the [API server setup guide](https://github.com/srl-labs/clab-api-server/blob/main/README.md) for configuration, alternative installation methods, and changing the lab storage directory.

### Good to know

- **Your login belongs to your lab host.** Use the Linux account allowed to access its API server; there is no separate app account to create.
- **Your lab files stay with your labs.** Topologies created through web or desktop are saved on the API host, in your user's `~/.clab` directory by default. VS Code works with files in the workspace you opened.
- **One app can reach several hosts.** Web and desktop let you add multiple API endpoints, each with its own login, so you can work with different lab environments from one app.

## Configuration

In VS Code, open Settings and search for `containerlab`. The [extension settings reference](apps/vscode-containerlab/README.md#extension-settings) covers node defaults, topology editing, packet capture, and more.

The web and desktop apps let you choose your API endpoint at login. Additional options are available through environment variables:

<details>
<summary>Web and desktop environment variables</summary>

For the web container, pass variables with `docker run -e NAME=value` before the image name. Certificate paths must refer to files mounted inside the container. For desktop, set variables in the environment used to launch the app.

| Variable | Default | Applies to | Purpose |
| --- | --- | --- | --- |
| `CLAB_API_TLS_VERIFY` | `false` | Web, desktop | Accept self-signed API certificates by default; set `true` to verify them. Applies only to API connections. |
| `PORT` | `3001` | Web | Port used to serve the web app. |
| `WEB_BASE_PATH` | unset | Web | Serve the app, assets, and API under a path such as `/web`. Configure your reverse proxy to preserve this prefix. |
| `WEB_TLS_ENABLE` | `true` | Web | Serve the app over HTTPS. |
| `WEB_TLS_AUTO_CERT` | `true` | Web | Generate a self-signed certificate when no certificate files are supplied. |
| `WEB_TLS_CERT_FILE` | unset | Web | Path to your HTTPS certificate. |
| `WEB_TLS_KEY_FILE` | unset | Web | Path to your HTTPS private key. |
| `WEB_TLS_HOST` | auto-detected | Web | Hostname to include in the generated certificate. |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | Web, desktop | Interface statistics interval requested from the API. |
| `CONTAINERLAB_DESKTOP_PORT` | `32180` | Desktop | Preferred local port for the app's embedded server. |
| `CONTAINERLAB_DESKTOP_DEBUG` | unset | Desktop | Enable app-server debug logging. |

</details>

For example, `WEB_BASE_PATH=/web` serves the app at `https://your-host/web/` using the same container image. Forward `/web/` requests, including WebSocket upgrades, to the web server without stripping the prefix. This setting also applies to `pnpm web:local`.

## Help and feedback

For questions and lab ideas, join the [Containerlab Discord](https://discord.gg/vAyddtaEV9). To report a bug or suggest a feature, [open an issue](https://github.com/srl-labs/containerlab-app/issues) and mention whether you're using VS Code, web, or desktop.

The [containerlab documentation](https://containerlab.dev/) covers topology files, supported node kinds, and lab examples.

## Development

Use Node.js `24.21.0` and pnpm `12.4.2`, as pinned in `package.json`. From the repository root:

```sh
corepack enable
corepack pnpm install --frozen-lockfile
```

Run `pnpm web:local` or `pnpm desktop:local` to launch an app, `pnpm vsix` to package the VS Code extension, or `pnpm pages:local` to work on the browser sandbox.

From WSL, use `pnpm desktop:windows` to build and launch the native Windows app with Windows window borders and controls. It uses Windows PowerShell interop; Node and pnpm only need to be installed in WSL. Close the app and rerun the command after edits.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development, builds, and tests, the [shared UI guide](packages/clab-ui/README.md) for `@containerlab/clab-ui`, and [RELEASING.md](RELEASING.md) for publishing.
