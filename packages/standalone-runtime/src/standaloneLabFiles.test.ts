import assert from "node:assert/strict";
import test from "node:test";

import { openLabFileInWorkspace, type LabFileWorkspace } from "./standaloneLabFiles";

/** A workspace of files and folders by path, recording what the flow does. */
function memoryWorkspace(files: Record<string, string>, folders: string[] = []) {
  const contents = new Map(Object.entries(files));
  const directories = new Set(folders);
  const tabs: Array<{ path: string; content: string; title: string }> = [];
  const notices: Array<[string, string]> = [];
  const workspace: LabFileWorkspace = {
    async list(_endpointId, directory) {
      if (directory !== "" && !directories.has(directory)) throw new Error("Not found");
      const prefix = directory === "" ? "" : `${directory}/`;
      const names = new Map<string, "file" | "directory">();
      for (const path of contents.keys()) {
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
          names.set(path.slice(prefix.length), "file");
        }
      }
      for (const path of directories) {
        if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
          names.set(path.slice(prefix.length), "directory");
        }
      }
      return [...names].map(([name, kind]) => ({ name, kind }));
    },
    async read(_endpointId, path) {
      return { content: contents.get(path) ?? "" };
    },
    async write({ path, content }) {
      const parent = path.split("/").slice(0, -1).join("/");
      if (parent !== "" && !directories.has(parent)) throw new Error("Parent directory does not exist");
      contents.set(path, content);
    },
    async createDirectory(_endpointId, path) {
      directories.add(path);
    },
    openTab: ({ path, content, title }) => tabs.push({ path, content, title }),
    notify: (message, severity) => notices.push([severity, message])
  };
  return { workspace, contents, directories, tabs, notices };
}

const topology = { endpointId: "local", topologyPath: "labs/dc.clab.yml", topologyDir: "/srv/ws/labs" };

test("an existing lab file opens in a tab", async () => {
  const lab = memoryWorkspace({ "labs/configs/r1.cfg": "hostname r1" }, ["labs", "labs/configs"]);

  await openLabFileInWorkspace({ path: "configs/r1.cfg", create: true }, topology, lab.workspace);

  assert.deepEqual(lab.tabs, [{ path: "labs/configs/r1.cfg", content: "hostname r1", title: "r1.cfg" }]);
  assert.deepEqual(lab.notices, []);
});

test("a missing lab file is created empty, with its folders", async () => {
  const lab = memoryWorkspace({}, ["labs"]);

  await openLabFileInWorkspace({ path: "configs/r2/startup.cfg", create: true }, topology, lab.workspace);

  assert.equal(lab.contents.get("labs/configs/r2/startup.cfg"), "");
  assert.deepEqual([...lab.directories].sort(), ["labs", "labs/configs", "labs/configs/r2"]);
  assert.deepEqual(lab.tabs, [{ path: "labs/configs/r2/startup.cfg", content: "", title: "startup.cfg" }]);
  assert.deepEqual(lab.notices, [["success", "Created labs/configs/r2/startup.cfg"]]);
});

test("files that cannot be opened are reported instead", async () => {
  const lab = memoryWorkspace({}, ["labs", "labs/configs"]);

  await openLabFileInWorkspace({ path: "/srv/ws/labs/missing.key" }, topology, lab.workspace);
  await openLabFileInWorkspace({ path: "/etc/hosts" }, topology, lab.workspace);
  await openLabFileInWorkspace({ path: "configs", create: true }, topology, lab.workspace);

  assert.deepEqual(lab.tabs, []);
  assert.equal(lab.contents.size, 0);
  assert.deepEqual(lab.notices, [
    ["warning", "labs/missing.key does not exist."],
    ["warning", "/etc/hosts is outside the lab workspace."],
    ["info", "labs/configs is a folder."]
  ]);
});
