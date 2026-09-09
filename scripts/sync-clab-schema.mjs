import { appendFile, readFile, writeFile } from "node:fs/promises";

const ref = process.argv[2] ?? "main";
const source = `https://raw.githubusercontent.com/srl-labs/containerlab/${encodeURIComponent(ref)}/schemas/clab.schema.json`;
const destination = new URL("../packages/clab-ui/schema/clab.schema.json", import.meta.url);
const response = await fetch(source);
if (!response.ok) {
  throw new Error(`Schema download failed: ${response.status} ${response.statusText}`);
}
const downloaded = await response.text();
const schema = JSON.parse(downloaded);
if (
  schema.$id !== "https://containerlab.dev/clab.schema.json" ||
  schema.type !== "object" ||
  !schema.definitions?.["node-config"]
) {
  throw new Error("Upstream response is not the expected Containerlab schema");
}
const changed = downloaded !== await readFile(destination, "utf8");
if (changed) {
  await writeFile(destination, downloaded);
}
console.log(`${changed ? "Updated" : "Already current:"} packages/clab-ui/schema/clab.schema.json from ${source}`);
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}
