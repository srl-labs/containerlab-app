import fs from "node:fs";
import { pathToFileURL } from "node:url";

export async function configureSandboxDomain(env = process.env, request = fetch) {
  const required = (name) => {
    if (!env[name]) throw new Error(`Missing ${name}`);
    return env[name];
  };
  const token = required("CLOUDFLARE_API_TOKEN");
  const account = required("CLOUDFLARE_ACCOUNT_ID");
  const zone = required("CLOUDFLARE_ZONE_ID");
  const project = required("PROJECT_NAME");
  const branch = required("SANDBOX_BRANCH");
  if (!/^[a-f0-9]{40}-pr$/.test(branch)) {
    throw new Error("SANDBOX_BRANCH must be a full commit SHA followed by -pr");
  }
  const hostname = `${branch}.containerlab.app`;
  const projectPath = `/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(project)}`;
  const dnsPath = `/zones/${encodeURIComponent(zone)}/dns_records`;
  const api = async (path, method = "GET", body) => {
    const response = await request(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(`Cloudflare ${method} ${path} failed (HTTP ${response.status}): ${JSON.stringify(data.errors)}`);
    }
    return data.result;
  };
  const details = await api(projectPath);
  if (!/^[a-z0-9-]+\.pages\.dev$/.test(details.subdomain)) {
    throw new Error("Cloudflare returned an invalid Pages project subdomain");
  }
  if (details.production_branch === branch) {
    throw new Error("The commit preview branch must not be the production branch");
  }
  const target = `${branch}.${details.subdomain}`;
  const readRecord = async () => {
    const records = await api(`${dnsPath}?name=${encodeURIComponent(hostname)}`);
    if (records.length > 1 || records.some((record) =>
      record.type !== "CNAME" || ![target, details.subdomain].includes(record.content)
    )) {
      throw new Error(`Refusing to replace conflicting DNS records for ${hostname}`);
    }
    return records[0];
  };
  await readRecord();
  const domains = await api(`${projectPath}/domains`);
  if (!domains.some((domain) => domain.name === hostname)) {
    await api(`${projectPath}/domains`, "POST", { name: hostname });
  }
  const record = await readRecord();
  const body = { type: "CNAME", name: hostname, content: target, proxied: true, ttl: 1 };
  if (!record) {
    await api(dnsPath, "POST", body);
  } else if (record.content !== target || !record.proxied) {
    await api(`${dnsPath}/${encodeURIComponent(record.id)}`, "PATCH", body);
  }
  return `https://${hostname}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const url = await configureSandboxDomain();
    const message = `Sandbox URL: ${url}\nCloudflare DNS and certificate activation may take a few minutes.\n`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
