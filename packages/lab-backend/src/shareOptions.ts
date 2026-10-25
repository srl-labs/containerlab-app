import type { ShareToolOptions } from "./contract/dto.ts";

// containerlab puts GoTTY credentials and shell into a `sh -c` command line in
// a privileged container, so only characters that are safe there are allowed.
// clab-api-server applies the same rules.
const GOTTY_USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const GOTTY_PASSWORD_PATTERN = /^[A-Za-z0-9._@%+=,!-]{1,64}$/;
const GOTTY_SHELL_PATTERN = /^\/?[A-Za-z0-9_][A-Za-z0-9_./-]{0,63}$/;

/** Why GoTTY share options cannot be used, or undefined when they can. */
export function gottyOptionsError(options: ShareToolOptions): string | undefined {
  const { username, password, shell, port } = options;
  if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
    return "The GoTTY port must be a number from 1 to 65535.";
  }
  if ((username === undefined) !== (password === undefined)) {
    return "Set both the GoTTY username and password, or neither.";
  }
  if (username !== undefined && !GOTTY_USERNAME_PATTERN.test(username)) {
    return "The GoTTY username may contain letters, digits, '.', '_' and '-' (up to 32 characters).";
  }
  if (password !== undefined && (!GOTTY_PASSWORD_PATTERN.test(password) || password.startsWith("-"))) {
    return "The GoTTY password may contain letters, digits and . _ @ % + = , ! - (up to 64 characters, not starting with '-').";
  }
  if (shell !== undefined && (!GOTTY_SHELL_PATTERN.test(shell) || shell.includes(".."))) {
    return "The GoTTY shell must be a command name or path such as bash or /bin/sh.";
  }
  return undefined;
}

/**
 * The read-only link of an sshx session started with `--enable-readers`: the
 * session URL with only the first key of its fragment, as containerlab prints it.
 */
export function sshxReadOnlyLink(link: string): string | undefined {
  const hashIndex = link.indexOf("#");
  if (hashIndex < 0) return undefined;
  const keys = link.slice(hashIndex + 1).split(",");
  return keys.length > 1 && keys[0] ? `${link.slice(0, hashIndex)}#${keys[0]}` : undefined;
}
