import type { ReactNode } from "react";

import {
  Alert,
  Avatar,
  Box,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import ExtensionIcon from "@mui/icons-material/Extension";
import FavoriteIcon from "@mui/icons-material/Favorite";
import GroupsIcon from "@mui/icons-material/Groups";

import { floatingRadius } from "../../theme/surfaces";
import { useWorkspaceHost } from "../WorkspaceHost";

interface AboutSettingsContentProps {
  showHeading?: boolean;
  versionCheck: string;
  versionError: string | null;
  versionInfo: string;
  versionLoading: boolean;
}

interface AboutAuthor {
  color: string;
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
    initials: "FS",
    color: "#2196F3"
  },
  {
    name: "Kaelem Chandra",
    title: "Maintainer",
    linkedIn: "https://linkedin.com/in/kaelem-chandra",
    initials: "KC",
    color: "#9C27B0",
    photo: "https://github.com/kaelemc.png"
  },
  {
    name: "Asad Arafat",
    title: "Maintainer",
    linkedIn: "https://www.linkedin.com/in/asadarafat/",
    initials: "AA",
    color: "#4CAF50"
  }
];

function AboutSection(props: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        overflow: "hidden",
        borderColor: "divider",
        backgroundColor:
          theme.palette.mode === "dark" ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.015)"
      })}
    >
      <Box sx={{ px: 2, py: 1.25 }}>
        <Typography variant="subtitle2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {props.icon}
          {props.title}
        </Typography>
      </Box>
      <Divider />
      {props.children}
    </Paper>
  );
}

function AuthorCards() {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 0.5,
        p: 1.5
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
            gap: 1,
            flex: 1,
            minWidth: 0,
            px: 1,
            py: 0.75,
            borderRadius: floatingRadius,
            color: "inherit",
            textDecoration: "none",
            "&:hover": { bgcolor: "action.hover" }
          }}
        >
          <Avatar
            src={author.photo}
            alt=""
            slotProps={{ img: { referrerPolicy: "no-referrer" } }}
            sx={{
              bgcolor: author.color,
              width: 28,
              height: 28,
              fontSize: "0.75rem"
            }}
          >
            {author.initials}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.2 }}>
              {author.name}
            </Typography>
            <Typography variant="caption" color={TEXT_SECONDARY} noWrap>
              {author.title}
            </Typography>
          </Box>
        </Box>
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
  const versionValue = versionLoading ? "Loading..." : versionInfo;
  const updateValue = versionLoading ? "Loading..." : versionCheck;

  return (
    <Stack spacing={2}>
      {showHeading && (
        <Box>
          <Typography variant="h6">About</Typography>
          <Typography variant="body2" color={TEXT_SECONDARY}>
            Containerlab App details, maintainers, and runtime diagnostics.
          </Typography>
        </Box>
      )}

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          alignItems: { xs: "flex-start", sm: "center" }
        }}
      >
        <Box
          component="img"
          src={publicAssetUrl("containerlab.svg")}
          alt=""
          sx={{ width: 56, height: 56, flexShrink: 0 }}
        />
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontWeight: 600
            }}
          >
            Containerlab App
          </Typography>
          <Typography variant="body2" color={TEXT_SECONDARY}>
            Interactive topology visualization and editing for Containerlab network labs in the
            standalone browser UI.
          </Typography>
        </Box>
      </Stack>

      <AboutSection title="Team" icon={<GroupsIcon fontSize="small" />}>
        <AuthorCards />
      </AboutSection>

      <AboutSection title="Runtime Version" icon={<ExtensionIcon fontSize="small" />}>
        <Stack spacing={2} sx={{ p: 2 }}>
          {versionError ? (
            <Alert
              severity="error"
              variant="outlined"
              sx={{
                color: "text.primary",
                borderColor: "error.main",
                bgcolor: "background.paper",
                "& .MuiAlert-icon": {
                  color: "error.main"
                }
              }}
            >
              {versionError}
            </Alert>
          ) : null}
          <TextField
            label="Containerlab Version"
            value={versionValue}
            fullWidth
            multiline
            minRows={3}
            slotProps={{ input: { readOnly: true } }}
            data-testid="standalone-settings-version-info"
          />
          <TextField
            label="Update Check"
            value={updateValue}
            fullWidth
            multiline
            minRows={3}
            slotProps={{ input: { readOnly: true } }}
            data-testid="standalone-settings-version-check"
          />
        </Stack>
      </AboutSection>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.5,
          color: TEXT_SECONDARY
        }}
      >
        <Typography variant="caption">Made with</Typography>
        <FavoriteIcon sx={{ fontSize: 14, color: "error.main" }} />
        <Typography variant="caption">for the network community</Typography>
      </Box>
    </Stack>
  );
}
