// Options for starting an sshx or GoTTY share of a lab. containerlab puts the
// GoTTY values into a shell command, so the rules match the lab backends'.

export type ShareTool = "sshx" | "gotty";

export interface ShareOptionsDraft {
  /** sshx: also create a read-only link. */
  enableReaders: boolean;
  port: string;
  /** GoTTY: set credentials instead of containerlab's admin/admin. */
  customCredentials: boolean;
  username: string;
  password: string;
  shell: string;
}

/** The options the hosts pass to `containerlab tools sshx|gotty attach|reattach`. */
export interface ShareOptionsResult {
  enableReaders?: boolean;
  port?: number;
  username?: string;
  password?: string;
  shell?: string;
}

type ShareOptionsErrors = Partial<Record<"port" | "username" | "password" | "shell", string>>;

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const PASSWORD_PATTERN = /^[A-Za-z0-9._@%+=,!-]{1,64}$/;
const SHELL_PATTERN = /^\/?[A-Za-z0-9_][A-Za-z0-9_./-]{0,63}$/;

const DEFAULT_GOTTY_PORT = 8080;

export function defaultShareOptionsDraft(port = DEFAULT_GOTTY_PORT): ShareOptionsDraft {
  return {
    enableReaders: false,
    port: String(port),
    customCredentials: false,
    username: "",
    password: "",
    shell: ""
  };
}

export function shareOptionsErrors(tool: ShareTool, draft: ShareOptionsDraft): ShareOptionsErrors {
  if (tool === "sshx") return {};
  const errors: ShareOptionsErrors = {};
  const port = Number(draft.port.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.port = "Enter a port from 1 to 65535.";
  }
  if (draft.customCredentials) {
    if (!USERNAME_PATTERN.test(draft.username)) {
      errors.username = "Letters, digits, '.', '_' and '-', up to 32 characters.";
    }
    if (!PASSWORD_PATTERN.test(draft.password) || draft.password.startsWith("-")) {
      errors.password = "Letters, digits and . _ @ % + = , ! - (not first), up to 64 characters.";
    }
  }
  const shell = draft.shell.trim();
  if (shell && (!SHELL_PATTERN.test(shell) || shell.includes(".."))) {
    errors.shell = "A command name or path, such as bash or /bin/sh.";
  }
  return errors;
}

export function shareOptionsFromDraft(tool: ShareTool, draft: ShareOptionsDraft): ShareOptionsResult {
  if (tool === "sshx") return draft.enableReaders ? { enableReaders: true } : {};
  const result: ShareOptionsResult = { port: Number(draft.port.trim()) };
  if (draft.customCredentials) {
    result.username = draft.username;
    result.password = draft.password;
  }
  const shell = draft.shell.trim();
  if (shell) result.shell = shell;
  return result;
}
