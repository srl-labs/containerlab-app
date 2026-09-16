import type { ReactNode } from "react";

import {
  Avatar,
  Box,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import ExtensionIcon from "@mui/icons-material/Extension";
import FavoriteIcon from "@mui/icons-material/Favorite";
import GroupsIcon from "@mui/icons-material/Groups";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

import { publicAssetUrl } from "../publicAssetUrl";

interface AboutLink {
  description: string;
  icon: ReactNode;
  label: string;
  url: string;
}

interface AboutAuthor {
  color: string;
  initials: string;
  linkedIn: string;
  name: string;
  title: string;
}

const TEXT_SECONDARY = "text.secondary";

const documentationLinks: AboutLink[] = [
  {
    label: "Containerlab Docs",
    description: "Full documentation",
    url: "https://containerlab.dev/",
    icon: <MenuBookIcon fontSize="small" />
  },
  {
    label: "Extension Docs",
    description: "VS Code extension guide",
    url: "https://containerlab.dev/manual/vsc-extension/",
    icon: <ExtensionIcon fontSize="small" />
  }
];

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
    color: "#9C27B0"
  },
  {
    name: "Asad Arafat",
    title: "Maintainer",
    linkedIn: "https://www.linkedin.com/in/asadarafat/",
    initials: "AA",
    color: "#4CAF50"
  }
];

function AboutSection(props: {
  children: ReactNode;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={(theme) => ({
        overflow: "hidden",
        borderColor: "divider",
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(255,255,255,0.03)"
            : "rgba(0,0,0,0.015)"
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

function LinkList(props: { links: AboutLink[] }) {
  return (
    <List disablePadding>
      {props.links.map((link, index) => (
        <Box key={link.url}>
          {index > 0 ? <Divider /> : null}
          <ListItemButton
            component="a"
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ alignItems: "flex-start", py: 1.5 }}
          >
            <ListItemIcon sx={{ minWidth: 36, color: TEXT_SECONDARY, mt: 0.25 }}>
              {link.icon}
            </ListItemIcon>
            <ListItemText
              primary={link.label}
              secondary={link.description}
              primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
              secondaryTypographyProps={{ variant: "caption", color: TEXT_SECONDARY }}
            />
            <OpenInNewIcon fontSize="small" sx={{ color: TEXT_SECONDARY, mt: 0.25 }} />
          </ListItemButton>
        </Box>
      ))}
    </List>
  );
}

function AuthorList() {
  return (
    <List disablePadding>
      {authors.map((author, index) => (
        <Box key={author.linkedIn}>
          {index > 0 ? <Divider /> : null}
          <ListItemButton
            component="a"
            href={author.linkedIn}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ alignItems: "flex-start", py: 1.5 }}
          >
            <ListItemIcon sx={{ minWidth: 48 }}>
              <Avatar sx={{ bgcolor: author.color, width: 32, height: 32, fontSize: "0.875rem" }}>
                {author.initials}
              </Avatar>
            </ListItemIcon>
            <ListItemText
              primary={author.name}
              secondary={author.title}
              primaryTypographyProps={{ variant: "body2", fontWeight: 600 }}
              secondaryTypographyProps={{ variant: "caption", color: TEXT_SECONDARY }}
            />
            <OpenInNewIcon fontSize="small" sx={{ color: TEXT_SECONDARY, mt: 0.25 }} />
          </ListItemButton>
        </Box>
      ))}
    </List>
  );
}

export function AboutSettingsContent() {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6">About</Typography>
        <Typography variant="body2" color={TEXT_SECONDARY}>
          TopoViewer details, project links, maintainers, and runtime diagnostics.
        </Typography>
      </Box>

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "flex-start", sm: "center" }}
      >
        <Box
          component="img"
          src={publicAssetUrl("containerlab.svg")}
          alt=""
          sx={{ width: 56, height: 56, flexShrink: 0 }}
        />
        <Box>
          <Typography variant="h5" fontWeight={600}>
            TopoViewer
          </Typography>
          <Typography variant="body2" color={TEXT_SECONDARY}>
            Interactive topology visualization and editing for Containerlab network labs in the
            standalone browser UI.
          </Typography>
        </Box>
      </Stack>

      <Stack direction={{ xs: "column", md: "row" }} spacing={2.5} alignItems="stretch">
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AboutSection title="Documentation" icon={<MenuBookIcon fontSize="small" />}>
            <LinkList links={documentationLinks} />
          </AboutSection>
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <AboutSection title="Team" icon={<GroupsIcon fontSize="small" />}>
            <AuthorList />
          </AboutSection>
        </Box>
      </Stack>

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
