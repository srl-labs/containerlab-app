const fs = require("node:fs/promises");
const path = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "linux") {
    return;
  }

  const executableName = context.packager.executableName;
  const executablePath = path.join(context.appOutDir, executableName);
  const realExecutablePath = `${executablePath}.bin`;

  try {
    await fs.access(realExecutablePath);
    return;
  } catch {
    // Continue: the executable has not been wrapped yet.
  }

  await fs.rename(executablePath, realExecutablePath);
  await fs.writeFile(
    executablePath,
    [
      "#!/bin/sh",
      'APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      `exec "$APP_DIR/${executableName}.bin" --ozone-platform=x11 --no-sandbox "$@"`,
      ""
    ].join("\n"),
    { mode: 0o755 }
  );
};
