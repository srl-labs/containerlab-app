# 4. clab-api-server

`clab-api-server` is the authenticated control plane and runtime authority for browser-hosted flows.

## Core job

- Accept Linux-user login at `POST /login`
- Protect `/api/v1/*` with JWT auth
- Enforce group-based authorization and resource ownership rules
- Execute runtime, file, capture, terminal, and topology operations server-side

## Public vs protected surface

| Surface | Routes | Notes |
|---|---|---|
| Public | `/health`, `/login`, `/swagger/*any`, `/redoc` | no bearer token required |
| Protected | `/api/v1/*` | all protected by auth middleware |

## Authentication model

| Item | Behavior |
|---|---|
| Credentials | Linux username and password validated through PAM |
| Login route | `POST /login` |
| Protected routes | `Authorization: Bearer <jwt>` required on `/api/v1/*` |
| Token lifetime | controlled by `JWT_EXPIRATION`, with optional per-login session duration requests |
| Token invalidation | tokens created before server start can be rejected after restart |

## Authorization model

| Check | Purpose |
|---|---|
| API-user group | normal authenticated API access (`API_USER_GROUP`, default `clab_api`) |
| Superuser group | elevated operations and ownership bypass where supported (`SUPERUSER_GROUP`, default `clab_admins`) |
| Ownership helpers | verify lab and container ownership using runtime metadata |

## Ownership behavior

Ownership checks intentionally use `404` in many mismatch cases so the API does not reveal resource existence to unauthorized users.

!!! info "Common status meaning"
    - `401`: no valid bearer token
    - `403`: authenticated, but missing a required elevated privilege
    - `404`: resource missing or intentionally concealed by ownership policy

## Endpoint families most relevant to the UI hosts

| Family | Purpose |
|---|---|
| `/api/v1/events` | platform event stream |
| `/api/v1/labs/*` | lab lifecycle, inspect, logs, topology documents, topology files |
| `/api/v1/terminal-sessions/*` | terminal session status and websocket streaming |
| `/api/v1/capture/wireshark-vnc-sessions/*` | VNC session readiness and proxying |
| `/api/v1/ui/*` | global custom nodes and icons |
| `/api/v1/tools/*` | edgeshark, netem, certs, veth, vxlan, and related tooling |
| `/api/v1/version*` | version and update-check helpers |

## Operational requirements

| Requirement | Why it matters |
|---|---|
| Server process must have runtime access | runtime, capture, and network operations need host-level access |
| `JWT_SECRET` must be set securely | default secrets are unsafe |
| `CORS_ALLOWED_ORIGINS` must be configured for browser clients | browser-hosted flows depend on correct origin handling |
| `TRUSTED_PROXIES` should be configured intentionally | generated URLs and proxy-awareness depend on it |
| API and superuser groups must be managed carefully | access control depends on Linux group membership |

## Browser-host implications

From the browser host's perspective, the API server is not just a data source. It is the authority that decides:

- whether a user may log in
- whether a user may see or mutate a lab
- whether a runtime operation is allowed
- whether a stream or capture session may be opened

If the browser UI looks correct but runtime behavior fails, the API server is still a likely root cause.
