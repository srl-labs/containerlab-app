/* global describe, it */
/**
 * Lab commands appear on topology files and on `.clab.gotmpl` topology
 * templates, in the explorer, editor title and command palette menus.
 */
import fs from "fs";
import path from "path";

import { expect } from "chai";

interface MenuItem {
  command?: string;
  submenu?: string;
  when?: string;
}

const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as {
  contributes: { menus: Record<string, MenuItem[]> };
};

const LAB_COMMANDS = [
  "containerlab.lab.deploy",
  "containerlab.lab.deploy.cleanup",
  "containerlab.lab.redeploy",
  "containerlab.lab.destroy",
  "containerlab.lab.destroy.cleanup"
];

function whenFor(menu: string, command: string): string | undefined {
  return manifest.contributes.menus[menu]?.find((item) => item.command === command)?.when;
}

function matches(when: string | undefined, fileName: string): boolean {
  const pattern = /resourceFilename =~ \/(.+)\/$/.exec(when ?? "")?.[1];
  return pattern !== undefined && new RegExp(pattern).test(fileName);
}

describe("topology file menus", () => {
  for (const menu of ["explorer/context", "editor/title/run", "editor/title/context"]) {
    it(`offers lab commands on templates in ${menu}`, () => {
      for (const command of LAB_COMMANDS) {
        const when = whenFor(menu, command);
        expect(matches(when, "fabric.clab.gotmpl"), `${command}: ${when}`).to.equal(true);
        expect(matches(when, "fabric.clab.yml"), `${command}: ${when}`).to.equal(true);
        expect(matches(when, "fabric.clab_vars.yml"), `${command}: ${when}`).to.equal(false);
      }
    });
  }
});
