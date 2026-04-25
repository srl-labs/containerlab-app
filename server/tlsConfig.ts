import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import { isIP } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ServerOptions as HttpsServerOptions } from "node:https";

import { parseBooleanEnv } from "./env.js";

const CERT_RENEWAL_MS = 30 * 24 * 60 * 60 * 1000;
const CERT_DAYS = 3650;

export interface ResolvedWebTlsConfig {
  certFile?: string;
  enabled: boolean;
  generated: boolean;
  https?: HttpsServerOptions;
  keyFile?: string;
}

export function resolveWebTlsConfig(env: NodeJS.ProcessEnv = process.env): ResolvedWebTlsConfig {
  const enabled = parseBooleanEnv(env.WEB_TLS_ENABLE, true);
  if (!enabled) {
    return { enabled: false, generated: false };
  }

  const certFile = env.WEB_TLS_CERT_FILE?.trim() ?? "";
  const keyFile = env.WEB_TLS_KEY_FILE?.trim() ?? "";
  if ((certFile.length === 0) !== (keyFile.length === 0)) {
    throw new Error("WEB_TLS_ENABLE is true but only one of WEB_TLS_CERT_FILE or WEB_TLS_KEY_FILE is set");
  }

  if (certFile && keyFile) {
    return {
      certFile,
      enabled: true,
      generated: false,
      https: readHttpsOptions(certFile, keyFile),
      keyFile
    };
  }

  if (!parseBooleanEnv(env.WEB_TLS_AUTO_CERT, true)) {
    throw new Error("WEB_TLS_ENABLE is true but WEB_TLS_CERT_FILE and WEB_TLS_KEY_FILE are not set, and WEB_TLS_AUTO_CERT is false");
  }

  const paths = defaultWebTlsPaths(env);
  const hosts = defaultWebTlsHosts(env);
  const generated = ensureSelfSignedCertificate(paths.certFile, paths.keyFile, hosts);
  return {
    ...paths,
    enabled: true,
    generated,
    https: readHttpsOptions(paths.certFile, paths.keyFile)
  };
}

export function defaultWebTlsPaths(env: NodeJS.ProcessEnv = process.env): {
  certFile: string;
  keyFile: string;
} {
  const configRoot = env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config");
  const tlsRoot = path.join(configRoot, "containerlab-web", "tls");
  return {
    certFile: path.join(tlsRoot, "localhost.pem"),
    keyFile: path.join(tlsRoot, "localhost-key.pem")
  };
}

export function defaultWebTlsHosts(env: NodeJS.ProcessEnv = process.env): string[] {
  return normalizeHosts([
    "localhost",
    "127.0.0.1",
    "::1",
    os.hostname(),
    env.WEB_TLS_HOST,
    env.HOST
  ]);
}

function readHttpsOptions(certFile: string, keyFile: string): HttpsServerOptions {
  return {
    cert: fs.readFileSync(certFile),
    key: fs.readFileSync(keyFile)
  };
}

function ensureSelfSignedCertificate(certFile: string, keyFile: string, hosts: string[]): boolean {
  if (certificateReusable(certFile, keyFile, hosts)) {
    return false;
  }

  fs.mkdirSync(path.dirname(certFile), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });

  const configFile = path.join(path.dirname(certFile), `openssl-${process.pid}-${Date.now()}.cnf`);
  fs.writeFileSync(configFile, buildOpenSslConfig(hosts), { mode: 0o600 });
  try {
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-nodes",
        "-newkey",
        "rsa:2048",
        "-sha256",
        "-days",
        String(CERT_DAYS),
        "-keyout",
        keyFile,
        "-out",
        certFile,
        "-config",
        configFile,
        "-extensions",
        "v3_req"
      ],
      { encoding: "utf8" }
    );
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(result.stderr || `openssl exited with status ${result.status}`);
    }
    fs.chmodSync(keyFile, 0o600);
    fs.chmodSync(certFile, 0o644);
    return true;
  } finally {
    fs.rmSync(configFile, { force: true });
  }
}

function certificateReusable(certFile: string, keyFile: string, hosts: string[]): boolean {
  if (!fs.existsSync(certFile) || !fs.existsSync(keyFile)) {
    return false;
  }

  try {
    const cert = new X509Certificate(fs.readFileSync(certFile));
    if (Date.parse(cert.validTo) <= Date.now() + CERT_RENEWAL_MS) {
      return false;
    }

    for (const host of hosts) {
      if (isIpAddress(host)) {
        if (!cert.checkIP(host)) {
          return false;
        }
        continue;
      }
      if (!cert.checkHost(host)) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

function buildOpenSslConfig(hosts: string[]): string {
  const dnsNames: string[] = [];
  const ipNames: string[] = [];
  for (const host of hosts) {
    if (isIpAddress(host)) {
      ipNames.push(host);
    } else {
      dnsNames.push(host);
    }
  }

  const altNames = [
    ...dnsNames.map((host, index) => `DNS.${index + 1} = ${host}`),
    ...ipNames.map((host, index) => `IP.${index + 1} = ${host}`)
  ];

  return [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "x509_extensions = v3_req",
    "prompt = no",
    "",
    "[req_distinguished_name]",
    "CN = containerlab local HTTPS",
    "",
    "[v3_req]",
    "keyUsage = keyEncipherment, digitalSignature",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[alt_names]",
    ...altNames,
    ""
  ].join("\n");
}

function normalizeHosts(hosts: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const host of hosts) {
    const candidate = normalizeHost(host);
    if (!candidate) {
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(candidate);
  }
  return normalized;
}

function normalizeHost(raw: string | undefined): string | null {
  let host = raw?.trim() ?? "";
  if (!host) {
    return null;
  }

  try {
    const parsed = new URL(host);
    if (parsed.hostname) {
      host = parsed.hostname;
    }
  } catch {
    // Continue with host[:port] parsing below.
  }

  const bracketless = host.replace(/^\[/, "").replace(/\]$/, "");
  if (isIpAddress(bracketless)) {
    return bracketless;
  }

  const match = /^([^:]+):(\d+)$/.exec(host);
  if (match?.[1]) {
    return match[1];
  }

  return bracketless;
}

function isIpAddress(host: string): boolean {
  return isIP(host) !== 0;
}
