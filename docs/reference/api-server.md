---
description: Settings, users, and REST API of clab-api-server.
---

# API server settings

`clab-api-server` reads its settings from environment variables. With the systemd install they live in `/etc/clab-api-server/clab-api-server.env`; restart the service after a change.
{ .lead }

## Common settings

| Variable | Default | What it does |
| --- | --- | --- |
| `API_PORT` | `8090` | Listen port. |
| `API_SERVER_HOST` | `localhost` | Host name or IP the apps use for API and SSH access. |
| `TLS_ENABLE` | `true` | Serve HTTPS. |
| `TLS_AUTO_CERT` | `true` | Create a self-signed certificate when no certificate files are set. |
| `JWT_SECRET` | set by the installer | Signs session tokens. Keep it secret. |
| `JWT_EXPIRATION` | `24h` | Longest session, for example `24h` or `7d`. |
| `API_USER_GROUP` | `clab_api` | Linux group allowed to sign in. |
| `SUPERUSER_GROUP` | `clab_admins` | Linux group that sees and manages every lab. |
| `CLAB_RUNTIME` | `docker` | Container runtime for labs. |
| `CLAB_SHARED_LABS_ROOT` | unset | Directory for [shared labs](../guides/shared-labs.md). Unset turns them off. |
| `CORS_ALLOWED_ORIGINS` | unset | Browser origins allowed to call the API directly. The web and desktop apps do not need this. |
| `TERMINAL_IDLE_TIMEOUT` | `30m` | How long a browser terminal keeps running after its last window disconnected. Only terminals that asked to be resumable wait; older apps and other API clients end theirs when they disconnect. |

The full list is in the [clab-api-server repository](https://github.com/srl-labs/clab-api-server).

## Users

Sign-in uses the host's Linux accounts and passwords. Regular users in `API_USER_GROUP` work with their own labs. Users in `SUPERUSER_GROUP` see and operate all labs.

```bash
sudo groupadd -f clab_api
sudo groupadd -f clab_admins
sudo usermod -aG clab_api alice
```

## Shared labs

`CLAB_SHARED_LABS_ROOT` should be a dedicated absolute path, separate from home directories, such as `/var/lib/containerlab/shared-labs`. If the API server runs in a container, mount the directory at the same path inside and outside.

Every signed-in user can read, edit, deploy, and destroy labs in it. There are no per-group permissions.

## Features of newer servers

Some actions need a recent clab-api-server: Mermaid and Graphviz exports, read-only SSHX links, GoTTY credentials and shell, node CPU and memory usage, live logs with stderr, and terminals that survive a dropped connection. The server lists them in `features` of its `/health` response. With an older server, the app hides these options or explains that the server needs an update; everything else keeps working.

## REST API

A running server documents its own API:

```text
https://<host>:8090/swagger/index.html
https://<host>:8090/redoc
```

The same reference is published at [srl-labs.github.io/clab-api-server](https://srl-labs.github.io/clab-api-server/).

Sign in for a token, then call the API with it:

```bash
TOKEN=$(curl -sk -X POST https://localhost:8090/login \
  -H "Content-Type: application/json" \
  -d '{"username":"alice","password":"..."}' | jq -r '.token')

curl -sk -H "Authorization: Bearer $TOKEN" https://localhost:8090/api/v1/labs
```
