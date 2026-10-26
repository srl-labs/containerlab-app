---
description: Run the containerlab web app as a container and reach your lab hosts, or the labs on its own host, from any browser.
---

# Web app

One container serves the app to every browser on your network. It signs in to `clab-api-server` on your lab hosts, or, when you turn it on, runs labs on its own host.
{ .lead }

Set up a [lab host](lab-host.md) first, or read [Run labs on the web app's host](#run-labs-on-the-web-apps-host) for a setup without one.

<figure class="diagram" markdown>

```clab file="diagrams/web-path.clab.yml" annotations="diagrams/web-path.clab.yml.annotations.json" title="How a browser reaches a lab" height="240" borderless="true" zoom="false" fit-padding="0.08"
```

</figure>

Your browser only talks to the web app. The web app talks to the API server, so the API server does not have to be reachable from your browser.

## Run it

=== "On the lab host"

    The simplest setup: the web app next to the API server, on the host network.

    ```bash
    docker run -d --name containerlab-app \
      --restart unless-stopped \
      --network host \
      ghcr.io/srl-labs/containerlab-web:latest
    ```

=== "On another machine"

    Point the web app at the lab host's API server:

    ```bash
    docker run -d --name containerlab-app \
      --restart unless-stopped \
      -p 3001:3001 \
      -e CLAB_API_URL=https://lab1.example.com:8090 \
      ghcr.io/srl-labs/containerlab-web:latest
    ```

=== "Bridge network, same host"

    Keep the container off the host network and reach the API server through Docker's host gateway:

    ```bash
    docker run -d --name containerlab-app \
      --restart unless-stopped \
      -p 3001:3001 \
      --add-host=host.docker.internal:host-gateway \
      -e CLAB_API_URL=https://host.docker.internal:8090 \
      ghcr.io/srl-labs/containerlab-web:latest
    ```

Open `https://<host>:3001` and accept the self-signed certificate. Then [sign in](sign-in.md). `CLAB_API_URL` only fills in the default on the sign-in screen; users can add other lab hosts.

The image runs on amd64 and arm64.

## Run labs on the web app's host

On a Linux machine that only you, or people you trust, can reach, the web app can run labs itself, with the host's containerlab and Docker, like the [desktop app](desktop.md#run-labs-on-this-computer). There is no API server and no sign-in: every browser that opens the app starts on the host's labs.

!!! warning "Anyone who can open the app runs labs as root on the host"
    Without sign-in, the app cannot tell users apart. Keep it on `localhost` or a trusted network, or put an authenticating proxy in front of it. For several users, use a [lab host](lab-host.md) instead.

Install containerlab on the host, then start the web app with the host's Docker socket and containerlab, and a topology folder at the same path inside and outside the container. containerlab passes that path to Docker for the nodes' files. Labs run as root, so the files in that folder belong to root.

```bash
sudo mkdir -p /srv/clab
docker run -d --name containerlab-app \
  --restart unless-stopped \
  --user root --privileged \
  --network host --pid host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/run/netns:/var/run/netns \
  -v /var/lib/docker/containers:/var/lib/docker/containers \
  -v /etc/hosts:/etc/hosts \
  -v "$(command -v containerlab)":/usr/local/bin/containerlab:ro \
  -v /srv/clab:/srv/clab \
  -e WEB_LOCAL_LABS=true \
  -e WEB_LOCAL_WORKSPACE=/srv/clab \
  ghcr.io/srl-labs/containerlab-web:latest
```

The explorer then shows the host under its host name, next to any lab hosts you sign in to. When containerlab or Docker is missing in the container, the start page lists what to fix, and `docker logs containerlab-app` says the same. All variables are in [web and desktop settings](../reference/app-settings.md#labs-on-the-web-apps-host).

## Use your own certificate

By default the web app creates a self-signed certificate. To use yours, mount it and set:

```bash
-v /etc/ssl/clab:/certs:ro \
-e WEB_TLS_CERT_FILE=/certs/web.crt \
-e WEB_TLS_KEY_FILE=/certs/web.key
```

If the API server has a trusted certificate too, set `CLAB_API_TLS_VERIFY=true`. All variables are in [web and desktop settings](../reference/app-settings.md#web-app).

## Behind a reverse proxy

Forward WebSocket upgrades to the web app. Live events, terminals, logs and Wireshark all use WebSockets, and each browser tab keeps one socket open for the live events of all its lab hosts. If the proxy does not pass WebSockets, live events fall back to one HTTP stream each, and browsers allow only six HTTP/1.1 connections per host: with several lab hosts or tabs, pages stop loading until a tab is closed. To serve the app under a path such as `/web`, set `WEB_BASE_PATH=/web` and forward `/web/` without stripping the prefix.

## If it does not connect

```bash
docker logs containerlab-app
```

If the sign-in screen loads but sign-in fails, test the API server from inside the container, since that is where the connection starts:

```bash
docker exec containerlab-app wget -qO- --no-check-certificate https://lab1.example.com:8090/health
```

<div class="next" markdown>
[:lucide-arrow-right: Sign in to a lab host](sign-in.md)
[:lucide-arrow-right: Shared labs for a team](../guides/shared-labs.md)
</div>
