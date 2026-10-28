// What a lab gets from its lab host where its settings leave a field empty.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import type { LabHostProfile } from "../../../host/labHostSupport";
import type { LabRuntimeKind } from "../../../host/lifecycleOptions";

/** containerlab's `--timeout` default: lab runtimes such as c9s wait longer for images. */
export function defaultTimeout(runtime: LabRuntimeKind): string {
  return runtime === "c9s" ? "10m" : "2m";
}

function nodeStorage(persistence: boolean | undefined): string {
  return persistence === false ? "Not kept (no persistent volumes)" : "Kept on persistent volumes";
}

export const LabHostDefaults: React.FC<{
  runtime: LabRuntimeKind;
  canSetTimeout: boolean;
  /** c9s on a host whose c9s options the lab may override. */
  c9sProfile?: LabHostProfile;
}> = ({ runtime, canSetTimeout, c9sProfile }) => {
  const rows: Array<[string, string]> = [
    ...(canSetTimeout
      ? ([["Timeout", `${defaultTimeout(runtime)} (containerlab default)`]] as Array<[string, string]>)
      : []),
    ["Max workers", "No limit"],
    ...(c9sProfile
      ? ([
          ["Namespace", c9sProfile.namespace ?? "c9s-<lab>"],
          ["Port exposure", c9sProfile.exposeType ?? "clabernetes default"],
          ["Node storage", nodeStorage(c9sProfile.persistence)],
          ["Image pull secret", c9sProfile.imagePullSecret ?? "None"]
        ] as Array<[string, string]>)
      : [])
  ];
  return (
    <Box
      data-testid="lab-settings-host-defaults"
      sx={{ px: 1.5, py: 1, border: 1, borderColor: "divider", borderRadius: 1 }}
    >
      <Typography variant="subtitle2">Lab host defaults</Typography>
      <Box
        component="dl"
        sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 2, rowGap: 0.25, m: 0, mt: 0.5 }}
      >
        {rows.map(([label, value]) => (
          <React.Fragment key={label}>
            <Typography component="dt" variant="caption" sx={{ color: "text.secondary" }}>
              {label}
            </Typography>
            <Typography component="dd" variant="caption" sx={{ m: 0 }}>
              {value}
            </Typography>
          </React.Fragment>
        ))}
      </Box>
    </Box>
  );
};
