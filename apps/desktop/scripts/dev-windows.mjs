import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const quotePowerShell = (value) => `'${value.replaceAll("'", "''")}'`;

function powershell(script, stdio = "pipe") {
  const command = `
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
    try {
      ${script}
    } catch {
      [Console]::Error.WriteLine($_.Exception.Message)
      exit 1
    }
  `;
  try {
    return execFileSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-OutputFormat",
        "Text",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      { encoding: "utf8", stdio },
    );
  } catch (error) {
    // Do not print the encoded command: it can contain forwarded credentials.
    throw new Error(
      error.code === "ENOENT"
        ? "Windows PowerShell is unavailable. Enable WSL Windows interop and ensure powershell.exe is on PATH."
        : error.stderr?.trim() ||
            `Windows PowerShell exited with status ${error.status}.`,
    );
  }
}

function main() {
  if (process.platform !== "linux" || !/microsoft/i.test(os.release())) {
    throw new Error(
      "Run pnpm desktop:windows from WSL. On Windows, use pnpm desktop:local.",
    );
  }

  // Keep each checkout's runnable copy on the Windows filesystem. This avoids
  // loading Chromium and its resources over the WSL network share.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
  );
  const executableName = `${manifest.build.win.executableName}.exe`;
  const checkoutId = createHash("sha256")
    .update(root)
    .digest("hex")
    .slice(0, 12);
  const windows = JSON.parse(
    powershell(`
    $directory = Join-Path $env:LOCALAPPDATA 'containerlab-desktop-dev\\${checkoutId}'
    if (Get-Process -Name ${quotePowerShell(manifest.build.win.executableName)} -ErrorAction SilentlyContinue) {
      throw 'Close the Windows Containerlab app before running pnpm desktop:windows again.'
    }
    [pscustomobject]@{
      directory = $directory
      architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
    } | ConvertTo-Json -Compress
  `),
  );
  if (!["x64", "arm64"].includes(windows.architecture)) {
    throw new Error(
      `Unsupported Windows architecture: ${windows.architecture}`,
    );
  }

  const output = path.join(root, "apps/desktop/release/windows-dev");
  for (const args of [
    ["ui"],
    [
      "--filter",
      "containerlab-desktop",
      "run",
      "package:dir",
      "--win",
      `--${windows.architecture}`,
      `--config.directories.output=${output}`,
      "--config.win.signExecutable=false",
    ],
  ]) {
    execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
  }

  const unpacked =
    windows.architecture === "x64" ? "win-unpacked" : "win-arm64-unpacked";
  const destination = execFileSync("wslpath", ["-u", windows.directory], {
    encoding: "utf8",
  }).trim();
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(path.join(output, unpacked), destination, { recursive: true });

  // WSL does not forward arbitrary environment variables to Windows processes.
  const environment = Object.entries(process.env)
    .filter(([name]) => /^(CLAB_|CONTAINERLAB_DESKTOP_)/.test(name))
    .map(
      ([name, value]) =>
        `[Environment]::SetEnvironmentVariable(${quotePowerShell(name)}, ${quotePowerShell(value)}, 'Process')`,
    )
    .join("\n");
  console.log(
    "Opening Containerlab on Windows. Close the window before rebuilding.",
  );
  powershell(
    `
    ${environment}
    $env:ELECTRON_RUN_AS_NODE = $null
    $directory = ${quotePowerShell(windows.directory)}
    $app = Start-Process -FilePath (Join-Path $directory ${quotePowerShell(executableName)}) -WorkingDirectory $directory -PassThru
    $app.WaitForExit()
    exit $app.ExitCode
  `,
    "inherit",
  );
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
