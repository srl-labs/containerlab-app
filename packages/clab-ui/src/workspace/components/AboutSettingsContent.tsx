import { useId, type ReactNode } from "react";

import { Alert, Avatar, Box, Stack, Typography } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/Favorite";

import { floatingRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import { useWorkspaceHost } from "../WorkspaceHost";

interface AboutSettingsContentProps {
  showHeading?: boolean;
  versionCheck: string;
  versionError: string | null;
  versionInfo: string;
  versionLoading: boolean;
}

interface AboutAuthor {
  initials: string;
  linkedIn: string;
  name: string;
  photo?: string;
  title: string;
}

const TEXT_SECONDARY = "text.secondary";

const authors: AboutAuthor[] = [
  {
    name: "Florian Schwarz",
    title: "Maintainer",
    linkedIn: "https://linkedin.com/in/florian-schwarz-812a34145",
    initials: "FS"
  },
  {
    name: "Kaelem Chandra",
    title: "Maintainer",
    linkedIn: "https://linkedin.com/in/kaelem-chandra",
    initials: "KC",
    photo: "https://github.com/kaelemc.png"
  },
  {
    name: "Asad Arafat",
    title: "Maintainer",
    linkedIn: "https://www.linkedin.com/in/asadarafat/",
    initials: "AA"
  }
];

function AboutSection(props: { children: ReactNode; title: string }) {
  return (
    <Box component="section" aria-label={props.title} sx={{ display: "grid", gap: 1 }}>
      <Typography variant="subtitle1">{props.title}</Typography>
      {props.children}
    </Box>
  );
}

function AuthorCards() {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
        gap: 1
      }}
    >
      {authors.map((author) => (
        <Box
          key={author.linkedIn}
          component="a"
          href={author.linkedIn}
          target="_blank"
          rel="noopener noreferrer"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            minWidth: 0,
            px: 1.25,
            py: 1,
            border: 1,
            borderColor: "divider",
            borderRadius: floatingRadius,
            color: "inherit",
            textDecoration: "none",
            transition: "background-color 120ms ease",
            "&:hover": { bgcolor: "action.hover" },
            "&:focus-visible": { outline: "1px solid var(--vscode-focusBorder)", outlineOffset: -1 },
            "@media (prefers-reduced-motion: reduce)": { transition: "none" }
          }}
        >
          <Avatar
            src={author.photo}
            alt=""
            slotProps={{ img: { referrerPolicy: "no-referrer" } }}
            sx={{
              width: 32,
              height: 32,
              fontSize: 12,
              fontWeight: 600,
              color: "text.primary",
              bgcolor: "color-mix(in srgb, var(--vscode-button-background) 22%, transparent)"
            }}
          >
            {author.initials}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body1" noWrap sx={{ fontWeight: 500 }}>
              {author.name}
            </Typography>
            <Typography variant="body2" color={TEXT_SECONDARY} noWrap>
              {author.title}
            </Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

interface VersionRowProps {
  label: string;
  testId?: string;
  value: string;
  /** Literal tool output reads in monospace; set false for prose such as status messages. */
  mono?: boolean;
}

/** One read-only value as a label and a value, named by its label for assistive tech. */
function VersionRow(props: VersionRowProps) {
  const id = useId();
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr)", sm: "160px minmax(0, 1fr)" },
        columnGap: 2,
        rowGap: 0.5,
        px: 1.5,
        py: 1.25,
        "&:not(:last-child)": { borderBottom: 1, borderColor: "divider" }
      }}
    >
      <Typography component="dt" id={id} variant="body2" sx={{ color: TEXT_SECONDARY }}>
        {props.label}
      </Typography>
      <Typography
        component="dd"
        aria-labelledby={id}
        data-testid={props.testId}
        sx={{
          m: 0,
          minWidth: 0,
          ...(props.mono === false
            ? { fontSize: 13, lineHeight: 1.5 }
            : { fontFamily: MONO_FONT_FAMILY, fontSize: 12, lineHeight: 1.6 }),
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere"
        }}
      >
        {props.value || "—"}
      </Typography>
    </Box>
  );
}

/** Read-only version details as a bordered label/value list. */
export function VersionList(props: { rows: VersionRowProps[] }) {
  return (
    <Box component="dl" sx={{ m: 0, border: 1, borderColor: "divider", borderRadius: floatingRadius }}>
      {props.rows.map((row) => (
        <VersionRow key={row.label} {...row} />
      ))}
    </Box>
  );
}

export function AboutSettingsContent({
  showHeading = true,
  versionCheck,
  versionError,
  versionInfo,
  versionLoading
}: AboutSettingsContentProps) {
  const { assetUrl: publicAssetUrl } = useWorkspaceHost();
  const versionValue = versionLoading ? "Loading…" : versionInfo;
  const updateValue = versionLoading ? "Loading…" : versionCheck;

  return (
    <Stack spacing={3}>
      {showHeading && (
        <Box>
          <Typography variant="h6">About</Typography>
          <Typography variant="body2" color={TEXT_SECONDARY}>
            Containerlab App details, maintainers, and runtime diagnostics.
          </Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
        <Box
          component="img"
          src={publicAssetUrl("containerlab.svg")}
          alt=""
          sx={{ width: 48, height: 48, flexShrink: 0 }}
        />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" component="h3">
            Containerlab App
          </Typography>
          <Typography variant="body2" color={TEXT_SECONDARY} sx={{ mt: 0.25 }}>
            Interactive topology visualization and editing for Containerlab network labs in the
            standalone browser UI.
          </Typography>
        </Box>
      </Box>

      <AboutSection title="Runtime">
        {versionError ? <Alert severity="error">{versionError}</Alert> : null}
        <VersionList
          rows={[
            { label: "Containerlab version", testId: "standalone-settings-version-info", value: versionValue },
            { label: "Update check", testId: "standalone-settings-version-check", value: updateValue, mono: false }
          ]}
        />
      </AboutSection>

      <AboutSection title="Team">
        <AuthorCards />
      </AboutSection>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.5,
          pt: 1,
          color: TEXT_SECONDARY
        }}
      >
        <Typography variant="caption">Made with</Typography>
        <FavoriteIcon sx={{ fontSize: 12, color: "error.main" }} />
        <Typography variant="caption">for the network community</Typography>
      </Box>
    </Stack>
  );
}
