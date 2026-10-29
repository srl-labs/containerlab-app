// Login credentials (`credentials`) of a node.
import React from "react";

import { InputField, PanelSection } from "../../ui/form";
import { useRuntimeLimit } from "../../../stores/labHostStore";
import type { NodeCredentials } from "../../../core/parsing/NodeCredentials";

import type { TabProps } from "./types";

const LEVEL_LABELS: Record<string, string> = {
  defaults: "topology defaults",
  kind: "kind settings",
  group: "group settings"
};

function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

/** Note under the username and password, saying where the login comes from */
function describeLogin(ownLogin: boolean, inheritedSource: string | undefined): string {
  if (inheritedSource === undefined) {
    return "Used for SSH logins and the generated inventories. Empty fields use the kind default.";
  }
  if (ownLogin) {
    return `Replaces the login from the ${levelLabel(inheritedSource)} as a whole. Empty fields use the kind default.`;
  }
  return `Inherited from the ${levelLabel(inheritedSource)}. Typing here sets a login for this node only.`;
}

export const CredentialsSection: React.FC<TabProps> = ({ data, onChange }) => {
  const credentialsLimit = useRuntimeLimit("nodeCredentials");
  if (data.isCustomTemplate === true) return null;

  const own = data.credentials ?? {};
  const inherited = data.inheritedCredentials ?? {};
  const ownLogin = isSet(own.username) || isSet(own.password);
  const fallback = ownLogin ? {} : inherited;
  const inheritsIdentityFile =
    !isSet(own.identityFile) && inherited.identityFileSource !== undefined;

  const update = (patch: Partial<NodeCredentials>) => {
    onChange({ credentials: { ...own, ...patch } });
  };

  return (
    <PanelSection
      title="Login Credentials"
      limit={credentialsLimit}
      limitKeepsEditable={isSet(own.username) || isSet(own.password) || isSet(own.identityFile)}
    >
      <InputField
        id="node-credentials-username"
        label="Username"
        value={own.username ?? ""}
        onChange={(value) => update({ username: value })}
        placeholder={fallback.username ?? "Kind default"}
      />
      <InputField
        id="node-credentials-password"
        label="Password"
        type="password"
        value={own.password ?? ""}
        onChange={(value) => update({ password: value })}
        placeholder={isSet(fallback.password) ? "Inherited password" : "Kind default"}
        helperText={describeLogin(ownLogin, inherited.source)}
      />
      <InputField
        id="node-credentials-identity-file"
        label="SSH Identity File"
        value={own.identityFile ?? ""}
        onChange={(value) => update({ identityFile: value })}
        placeholder={inherited.identityFile ?? "~/.ssh/id_ed25519"}
        helperText={
          inheritsIdentityFile
            ? `Inherited from the ${levelLabel(inherited.identityFileSource ?? "")}`
            : "Private key for SSH. A relative path starts at the topology folder."
        }
      />
    </PanelSection>
  );
};
