---
description: Environment variables for the containerlab web app and desktop app.
---

# Web and desktop settings

Both apps are configured with environment variables. Everything else, like lab hosts and appearance, is set in the app.
{ .lead }

## Web app

Pass these with `-e` to `docker run`.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3001` | Port the web app listens on. |
| `CLAB_API_URL` | `https://localhost:8090` | API Server URL pre-filled on the sign-in screen. |
| `CLAB_API_TLS_VERIFY` | `false` | Verify the API Server's certificate. Turn on when it is trusted. |
| `WEB_TLS_ENABLE` | `true` | Serve the app over HTTPS. |
| `WEB_TLS_AUTO_CERT` | `true` | Create a self-signed certificate when no certificate files are set. |
| `WEB_TLS_CERT_FILE` | unset | Path to your certificate inside the container. |
| `WEB_TLS_KEY_FILE` | unset | Path to its private key. |
| `WEB_TLS_HOST` | detected | Host name written into the self-signed certificate. |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | How often interface statistics refresh. |

### Labs on the web app's host

These run labs on the web app's own host, without `clab-api-server`; see [Run labs on the web app's host](../install/web.md#run-labs-on-the-web-apps-host).

| Variable | Default | What it does |
| --- | --- | --- |
| `WEB_LOCAL_LABS` | `false` | Run labs on the web app's host. Every browser that opens the app can then run labs there, without signing in. |
| `WEB_LOCAL_HOST_SCRIPTS` | `false` | Let [script buttons](../guides/script-buttons.md) run shell scripts on the web app's host, as its OS user. With `WEB_LOCAL_LABS` every browser that opens the app can then do that, without signing in. Has no effect with `c9s`. |
| `WEB_ALLOWED_HOSTS` | any | Host names this app answers for, separated by commas, for example `labs.example.com,10.0.0.5:3001`. Set it when labs run on the web app's host. |
| `WEB_LOCAL_LABEL` | host name | Name of the host in the explorer. |
| `WEB_LOCAL_CLAB_BINARY` | `containerlab` | containerlab binary, looked up in `PATH`. |
| `WEB_LOCAL_RUNTIME` | `docker` | Lab runtime: `docker`, `podman`, or `c9s` for a [Kubernetes cluster](../guides/kubernetes.md#web-app). |
| `WEB_LOCAL_KUBECONFIG` | `KUBECONFIG`, else `~/.kube/config` | With `c9s`: the kubeconfig file. In a pod without one, the pod's ServiceAccount. |
| `WEB_LOCAL_KUBE_CONTEXT` | current context | With `c9s`: the kubeconfig context of the cluster. |
| `WEB_LOCAL_KUBE_NAMESPACE` | `c9s-<lab>` per lab | With `c9s`: one namespace for every lab. |
| `WEB_LOCAL_C9S_EXPOSE_TYPE` | unset | With `c9s`: `ClusterIP`, `Headless`, `LoadBalancer`, or `None`. |
| `WEB_LOCAL_C9S_PERSISTENCE` | `true` | With `c9s`: `false` turns persistent node volumes off. |
| `WEB_LOCAL_C9S_IMAGE_PULL_SECRET` | unset | With `c9s`: the image pull secret of every lab's pods. |
| `WEB_LOCAL_DOCKER_SOCKET` | `/var/run/docker.sock` | Docker or Podman socket. |
| `WEB_LOCAL_WORKSPACE` | `~/.clab` of the container user | Folder for the topologies. Mount it at the same path as on the host. |
| `WEB_LOCAL_WIRESHARK_IMAGE` | `ghcr.io/srl-labs/wireshark-vnc-docker:latest` | Image of the Wireshark VNC containers. With `c9s` it needs the capture pipe (`CLABWIRE_CAPTURE_PIPE`). |
| `WEB_LOCAL_SUDO` | `false` | Run containerlab with `sudo -n`. |

### Images

The **Images** entry under Overview searches [LabHub](https://labhub.srlinux.dev) for router images, pulls or uploads them, builds [vrnetlab](https://github.com/srl-labs/vrnetlab) images and writes the matching Node Templates to `<WEB_LOCAL_WORKSPACE>/ui/custom-nodes.json`. It drives the [`climg`](https://github.com/dathtd119/climg) command line tool and is off unless `WEB_LOCAL_CLIMG_PATH` is set. It needs [labs on the web app's host](#labs-on-the-web-apps-host) (`WEB_LOCAL_LABS`) and does not appear for lab hosts or with `c9s`.

Install `climg` on the host (or mount it into the container) first:

```bash
pipx install git+https://github.com/dathtd119/climg
```

| Variable | Default | What it does |
| --- | --- | --- |
| `WEB_LOCAL_CLIMG_PATH` | unset: Images is off | Absolute path of the `climg` executable, for example the output of `command -v climg`. The only program the app runs for Images. |
| `WEB_LOCAL_CLIMG_CONFIG` | unset: `climg`'s own config | Absolute path of the `climg` config file, passed as `CLIMG_CONFIG`. |
| `WEB_LOCAL_CLIMG_STATE` | unset: the state folder of the `climg` config | Absolute path of the `climg` state folder, passed as `CLIMG_STATE`. |
| `WEB_LOCAL_CLIMG_USER` | unset: the app's own user | `uid:gid` that `climg` runs as. Required when the app runs as root, for example in the Docker image, and must not be `0:0`. |
| `WEB_LOCAL_CLIMG_HOME` | home of that user in `/etc/passwd` | Absolute path passed to `climg` as `HOME`. Set it when the container's user database differs from the host's. |
| `WEB_LOCAL_IMAGES_UPLOAD_MAX` | `20G` | Largest image upload, in bytes or with a `K`, `M`, `G`, `T` suffix. |
| `WEB_LOCAL_IMAGES_MAX_RUNNING` | `1` | Pull and build jobs that run at once; the others wait in a queue. |
| `WEB_LOCAL_IMAGES_MAX_QUEUED` | `20` | Jobs that may wait; starting one more is refused. `0` means no waiting. |

!!! warning "climg runs as the configured user"
    Without sign-in, every browser that can open the app can pull, upload and build images and edit the Node Templates, and the app runs `climg` as `WEB_LOCAL_CLIMG_USER` (or its own user) to do so. Vrnetlab builds use Docker, so that user needs Docker access. Use an unprivileged user and keep the app on `localhost` or a trusted network.

To run the Docker image with `climg`, build `Dockerfile.images` on top of the web image and start it with `scripts/run-images-container.sh`; the script's header lists its settings (`CLIMG_PATH` and `VRNETLAB` are required).

## Desktop app

Set these in the environment that starts the app.

| Variable | Default | What it does |
| --- | --- | --- |
| `CLAB_API_URL` | `https://localhost:8090` | API Server URL pre-filled on the sign-in screen. |
| `CLAB_API_TLS_VERIFY` | `false` | Verify the API Server's certificate. |
| `CONTAINERLAB_DESKTOP_PORT` | `32180` | Preferred local port for the app's built-in server. It only listens on loopback. |
| `CONTAINERLAB_DESKTOP_DEBUG` | unset | Log debug output from the built-in server. |
| `CONTAINERLAB_DESKTOP_LOCAL` | `true` | Run labs on **This computer** with the local containerlab. Linux only. Set to `false` to start on the sign-in page. |
| `CONTAINERLAB_DESKTOP_CLAB_BINARY` | `containerlab` | containerlab binary for **This computer**, looked up in `PATH`. |
| `CONTAINERLAB_DESKTOP_RUNTIME` | `docker` | Lab runtime for **This computer**: `docker`, `podman`, or `c9s` to run its labs on a [Kubernetes cluster](../guides/kubernetes.md#where-it-is-kept) instead. |
| `CONTAINERLAB_DESKTOP_KUBECONFIG` | `KUBECONFIG`, else `~/.kube/config` | With `c9s`: the kubeconfig file. |
| `CONTAINERLAB_DESKTOP_KUBE_CONTEXT` | current context | With `c9s`: the kubeconfig context of the cluster. |
| `CONTAINERLAB_DESKTOP_KUBE_NAMESPACE` | `c9s-<lab>` per lab | With `c9s`: one namespace for every lab. |
| `CONTAINERLAB_DESKTOP_C9S_EXPOSE_TYPE` | unset | With `c9s`: `ClusterIP`, `Headless`, `LoadBalancer`, or `None`. |
| `CONTAINERLAB_DESKTOP_C9S_PERSISTENCE` | `true` | With `c9s`: `false` turns persistent node volumes off. |
| `CONTAINERLAB_DESKTOP_C9S_IMAGE_PULL_SECRET` | unset | With `c9s`: the image pull secret of every lab's pods. |
| `CONTAINERLAB_DESKTOP_DOCKER_SOCKET` | `/var/run/docker.sock` | Docker or Podman socket for **This computer**. |
| `CONTAINERLAB_DESKTOP_WORKSPACE` | `~/.clab` | Folder for the topologies of **This computer**. |
| `CONTAINERLAB_DESKTOP_WIRESHARK_IMAGE` | `ghcr.io/srl-labs/wireshark-vnc-docker:latest` | Image of the Wireshark VNC containers, also of the clusters. With `c9s` it needs the capture pipe (`CLABWIRE_CAPTURE_PIPE`). |
| `CONTAINERLAB_DESKTOP_SUDO` | `false` | Run containerlab with `sudo -n`. Needs passwordless sudo. |

`CONTAINERLAB_DESKTOP_HOST_SCRIPTS`, or `hostScripts` in the file, turns [script buttons](../guides/script-buttons.md) on this computer on or off. They are on by default.

The variables override `~/.config/Containerlab/local-backend.json`; see [Run labs on this computer](../install/desktop.md#run-labs-on-this-computer). Kubernetes clusters next to **This computer** are kept under `clusters` in that file; add, edit, and remove them under **Settings** > **Lab hosts**, and the app writes the file. See [Labs on Kubernetes](../guides/kubernetes.md#add-a-cluster). Like **This computer**, clusters need Linux.
