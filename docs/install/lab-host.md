---
description: Install clab-api-server on a Linux machine, so every app can work with its labs from anywhere.
---

# Set up a lab host

A lab host is a Linux machine that runs `clab-api-server`. The VS Code extension, the desktop app, and the web app sign in to it and work with its labs from anywhere. The API Server ships containerlab built in, so there is nothing else to install.
{ .lead }

You need one to work with labs on another machine, from macOS or Windows, or with several people on one server. To run labs on the Linux machine in front of you, skip this page: the [VS Code extension](vscode.md) and the [desktop app](desktop.md#run-labs-on-this-computer) run containerlab themselves.

<div class="facts" markdown>
<div markdown>

Runs on

Linux with Docker. On macOS or Windows, use a Linux VM, OrbStack, Docker Desktop's VM, or a remote server.

</div>
<div markdown>

Listens on

HTTPS port `8090`, with a self-signed certificate until you provide your own.

</div>
<div markdown>

Who can sign in

Linux users in the `clab_api` group (regular) or `clab_admins` (sees and manages every lab).

</div>
</div>

## Install as a service

This is the setup for a machine you keep using.

<div class="steps" markdown>

1. **Run the installer.**

    ```bash
    curl -fsSL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo bash -s -- install
    ```

    It installs `/usr/local/bin/clab-api-server`, a systemd unit, the `clab_api` and `clab_admins` groups, and a config file with a random `JWT_SECRET`.

2. **Set the host name.** In `/etc/clab-api-server/clab-api-server.env`, set `API_SERVER_HOST` to the name or IP address your apps will use.

    ```bash
    sudoedit /etc/clab-api-server/clab-api-server.env
    ```

3. **Let users in.** Add each person who should sign in to `clab_api`:

    ```bash
    sudo usermod -aG clab_api alice
    ```

4. **Start it.**

    ```bash
    sudo systemctl enable --now clab-api-server
    ```

5. **Check it answers.**

    ```bash
    curl -k https://localhost:8090/health
    ```

</div>

The service runs as root because it manages containers, network namespaces, and files for every user. Users still sign in as themselves, and each user's labs live in their own home directory.

Next, [sign in from the desktop or web app](sign-in.md).

## Other ways to run it

??? note "Quick trial with containerlab"

    If containerlab is already installed, it can start the API Server as a container:

    ```bash
    sudo containerlab tools api-server start --labs-dir /opt/containerlab/labs
    sudo containerlab tools api-server status
    sudo containerlab tools api-server stop
    ```

    See the [`tools api-server` reference](https://containerlab.dev/cmd/tools/api-server/start/) for all flags. It also listens on HTTPS port `8090`.

??? note "As a container you manage"

    ```bash
    docker run -d \
      --name clab-api-server \
      --privileged \
      --network host \
      --pid host \
      -v /var/run/docker.sock:/var/run/docker.sock \
      -v /var/run/netns:/var/run/netns \
      -v /var/lib/docker/containers:/var/lib/docker/containers \
      -v /etc/passwd:/etc/passwd:ro \
      -v /etc/shadow:/etc/shadow:ro \
      -v /etc/group:/etc/group:ro \
      -v /etc/gshadow:/etc/gshadow:ro \
      -v /home:/home \
      ghcr.io/srl-labs/clab-api-server/clab-api-server:latest
    ```

    The mounts give it the Docker socket, network namespaces, the host's users for sign-in, and the users' home directories for lab files.

??? note "Run the binary by hand"

    ```bash
    curl -fsSL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo bash -s -- pull-only
    sudo clab-api-server -env-file /path/to/clab-api-server.env
    ```

    Without `-env-file`, it reads environment variables and a `.env` file in the current directory.

## Upgrade or remove

```bash
# Latest release
sudo clab-api-server version upgrade

# A specific release, also for downgrades
curl -fsSL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo bash -s -- upgrade --version clab-0.73.0-api-0.2.1

# Remove the service and binary, keep the config
curl -fsSL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo bash -s -- uninstall
```

Add `--purge` to `uninstall` to delete the config file too.

## Share labs with everyone on the host

Set `CLAB_SHARED_LABS_ROOT` to a dedicated directory, for example `/var/lib/containerlab/shared-labs`, and restart the service. Every signed-in user then sees a **Shared labs** folder. See [Shared labs](../guides/shared-labs.md).

All settings, the REST API, and its docs are in the [API Server reference](../reference/api-server.md).

<div class="next" markdown>
[:lucide-arrow-right: Sign in to a lab host](sign-in.md)
[:lucide-arrow-right: Install the desktop app](desktop.md)
[:lucide-arrow-right: Run the web app](web.md)
</div>
