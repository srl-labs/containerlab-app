---
description: Environment variables for the containerlab web app and desktop app.
---

# Web and desktop settings

Both apps are configured with environment variables. Everything else, like endpoints and appearance, is set in the app.
{ .lead }

## Web app

Pass these with `-e` to `docker run`.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3001` | Port the web app listens on. |
| `CLAB_API_URL` | `https://localhost:8090` | API server URL pre-filled on the sign-in screen. |
| `CLAB_API_TLS_VERIFY` | `false` | Verify the API server's certificate. Turn on when it is trusted. |
| `WEB_TLS_ENABLE` | `true` | Serve the app over HTTPS. |
| `WEB_TLS_AUTO_CERT` | `true` | Create a self-signed certificate when no certificate files are set. |
| `WEB_TLS_CERT_FILE` | unset | Path to your certificate inside the container. |
| `WEB_TLS_KEY_FILE` | unset | Path to its private key. |
| `WEB_TLS_HOST` | detected | Host name written into the self-signed certificate. |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | How often interface statistics refresh. |

## Desktop app

Set these in the environment that starts the app.

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAB_API_URL` | `https://localhost:8090` | API server URL pre-filled on the sign-in screen. |
| `CLAB_API_TLS_VERIFY` | `false` | Verify the API server's certificate. |
| `CONTAINERLAB_DESKTOP_PORT` | `32180` | Preferred local port for the app's built-in server. It only listens on loopback. |
| `CONTAINERLAB_DESKTOP_DEBUG` | unset | Log debug output from the built-in server. |
| `CONTAINERLAB_DESKTOP_LOCAL` | `true` | Offer **This computer**, labs with the local containerlab. Linux only. |
| `CONTAINERLAB_DESKTOP_CLAB_BINARY` | `containerlab` | containerlab binary for **This computer**, looked up in `PATH`. |
| `CONTAINERLAB_DESKTOP_RUNTIME` | `docker` | Container runtime for **This computer**: `docker` or `podman`. |
| `CONTAINERLAB_DESKTOP_DOCKER_SOCKET` | `/var/run/docker.sock` | Docker or Podman socket for **This computer**. |
| `CONTAINERLAB_DESKTOP_WORKSPACE` | `~/.clab` | Folder for the topologies of **This computer**. |
| `CONTAINERLAB_DESKTOP_SUDO` | `false` | Run containerlab with `sudo -n`. Needs passwordless sudo. |

The variables override `~/.config/Containerlab/local-backend.json`; see [Run labs on this computer](../install/desktop.md#run-labs-on-this-computer).
