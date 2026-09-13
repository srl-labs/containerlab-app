import fs from "node:fs";
const {packageManager} = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const expected = packageManager.replace('@', '/');
if (!process.env.npm_config_user_agent?.startsWith(`${expected} `)) {
  console.error(`Use ${packageManager}: run corepack pnpm install (see README.md).`);
  process.exit(1);
}
