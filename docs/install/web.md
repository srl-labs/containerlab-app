---
description: Run the containerlab web app as a container and reach your lab hosts from any browser.
---

# Web app

One container serves the app to every browser on your network. Like the desktop app, it signs in to `clab-api-server` on your lab hosts.
{ .lead }

Set up a [lab host](lab-host.md) first.

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

## Use your own certificate

By default the web app creates a self-signed certificate. To use yours, mount it and set:

```bash
-v /etc/ssl/clab:/certs:ro \
-e WEB_TLS_CERT_FILE=/certs/web.crt \
-e WEB_TLS_KEY_FILE=/certs/web.key
```

If the API server has a trusted certificate too, set `CLAB_API_TLS_VERIFY=true`. All variables are in [web and desktop settings](../reference/app-settings.md#web-app).

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
