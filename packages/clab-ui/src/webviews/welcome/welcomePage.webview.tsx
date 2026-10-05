/* eslint-disable import-x/max-dependencies */
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LaunchIcon from "@mui/icons-material/Launch";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Container from "@mui/material/Container";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Checkbox from "@mui/material/Checkbox";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { MuiThemeProvider } from "../../theme/index";
import { controlRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import { useMessageListener, usePostMessage } from "../shared/hooks";
import containerlabLogo from "../../assets/images/containerlab.svg";

interface PopularRepo {
  name: string;
  html_url: string;
  description: string;
  stargazers_count: number;
}

interface WelcomeInitialData {
  extensionVersion?: string;
}

interface WelcomeReposLoadedMessage {
  command: "reposLoaded";
  repos?: PopularRepo[];
  usingFallback?: boolean;
}

type WelcomeIncomingMessage = WelcomeReposLoadedMessage;

type WelcomeOutgoingMessage =
  | { command: "createExample" }
  | { command: "dontShowAgain"; value: boolean }
  | { command: "getRepos" };

const RESOURCE_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Containerlab Documentation", href: "https://containerlab.dev/" },
  {
    label: "VS Code Extension Documentation",
    href: "https://containerlab.dev/manual/vsc-extension/"
  },
  { label: "Browse Labs on GitHub (srl-labs)", href: "https://github.com/srl-labs/" },
  {
    label: 'Find more labs tagged with "clab-topo"',
    href: "https://github.com/search?q=topic%3Aclab-topo++fork%3Atrue&type=repositories"
  },
  { label: "Join our Discord server", href: "https://discord.gg/vAyddtaEV9" },
  {
    label: "Download cshargextcap Wireshark plugin",
    href: "https://github.com/siemens/cshargextcap/releases/latest"
  }
];

const COMMUNITY_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  {
    label: "Extension Releases",
    href: "https://github.com/srl-labs/containerlab-app/releases/"
  },
  {
    label: "Containerlab Latest Release",
    href: "https://github.com/srl-labs/containerlab/releases/latest"
  },
  {
    label: "Containerlab Release History",
    href: "https://github.com/srl-labs/containerlab/releases/"
  },
  { label: "Discord", href: "https://discord.gg/vAyddtaEV9" }
];

export function WelcomePageApp(): React.JSX.Element {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as WelcomeInitialData;
  const extensionVersion = initialData.extensionVersion ?? "unknown";

  const postMessage = usePostMessage<WelcomeOutgoingMessage>();

  const [dontShowAgain, setDontShowAgain] = React.useState(false);
  const [repos, setRepos] = React.useState<PopularRepo[]>([]);
  const [usingFallback, setUsingFallback] = React.useState(false);
  const [isLoadingRepos, setIsLoadingRepos] = React.useState(true);

  useMessageListener<WelcomeIncomingMessage>((message) => {
    if (message.command !== "reposLoaded") {
      return;
    }

    setRepos(Array.isArray(message.repos) ? message.repos : []);
    setUsingFallback(Boolean(message.usingFallback));
    setIsLoadingRepos(false);
  });

  React.useEffect(() => {
    postMessage({ command: "getRepos" });
  }, [postMessage]);

  return (
    <MuiThemeProvider>
      <Box
        sx={{
          width: "100%",
          height: "100%",
          overflowY: "auto",
          backgroundColor: "background.default",
          color: "text.primary"
        }}
      >
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 }, px: { xs: 2, md: 4 } }}>
          <Stack spacing={4}>
            <Stack spacing={3}>
              <Stack
                direction="row"
                spacing={2}
                sx={{
                  alignItems: "center"
                }}
              >
                <Box
                  component="img"
                  src={containerlabLogo}
                  alt="Containerlab"
                  sx={{
                    width: { xs: 48, md: 56 },
                    height: { xs: 48, md: 56 },
                    objectFit: "contain",
                    flexShrink: 0
                  }}
                />
                <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                  <Typography variant="h4">Welcome to Containerlab</Typography>
                  <Stack
                    direction="row"
                    spacing={2}
                    useFlexGap
                    sx={{
                      alignItems: "center",
                      flexWrap: "wrap",
                      rowGap: 0.5
                    }}
                  >
                    <Typography variant="body2" sx={{ color: "text.secondary" }}>
                      Extension v{extensionVersion}
                    </Typography>
                    {COMMUNITY_LINKS.map((link) => (
                      <Link
                        key={link.label}
                        variant="body2"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.5,
                          "& .MuiSvgIcon-root": { fontSize: 12 }
                        }}
                      >
                        {link.label}
                        <LaunchIcon />
                      </Link>
                    ))}
                  </Stack>
                </Stack>
              </Stack>

              <Divider />
            </Stack>

            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={{ xs: 4, md: 6 }}
              sx={{
                alignItems: "flex-start"
              }}
            >
              <Stack spacing={4} sx={{ flex: "1 1 50%", minWidth: 0 }}>
                <Stack spacing={1}>
                  <Typography variant="h6">Getting Started</Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: "text.secondary"
                    }}
                  >
                    The Containerlab extension integrates containerlab directly into VS Code,
                    providing an explorer for managing labs and containers. Create, deploy, and
                    manage network topologies with just a few clicks.
                  </Typography>
                  <Stack
                    spacing={1}
                    sx={{
                      alignItems: "flex-start",
                      pt: 1
                    }}
                  >
                    <Button
                      variant="contained"
                      onClick={() => {
                        postMessage({ command: "createExample" });
                      }}
                    >
                      Create Example Topology
                    </Button>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary"
                      }}
                    >
                      Creates{" "}
                      <Box component="code" sx={{ fontFamily: MONO_FONT_FAMILY }}>
                        example.clab.yml
                      </Box>{" "}
                      in your current workspace.
                    </Typography>
                  </Stack>
                </Stack>

                <Stack spacing={1}>
                  <Typography variant="h6">Documentation and Resources</Typography>
                  <List dense disablePadding>
                    {RESOURCE_LINKS.map((link) => (
                      <ListItem key={link.label} disableGutters sx={{ py: 0.5 }}>
                        <Link href={link.href} target="_blank" rel="noreferrer noopener">
                          {link.label}
                        </Link>
                      </ListItem>
                    ))}
                  </List>
                </Stack>

                <Box>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={dontShowAgain}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setDontShowAgain(checked);
                          postMessage({ command: "dontShowAgain", value: checked });
                        }}
                      />
                    }
                    label="Don't show this page again"
                  />
                </Box>
              </Stack>

              <Stack spacing={1} sx={{ flex: "1 1 50%", minWidth: 0, width: "100%" }}>
                <Typography variant="h6">Popular Topologies</Typography>

                {usingFallback ? (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 0.75,
                      color: "text.secondary",
                      "& .MuiSvgIcon-root": { fontSize: 14, mt: "1px" }
                    }}
                  >
                    <InfoOutlinedIcon />
                    Using cached repository data due to GitHub API limits or temporary failures.
                  </Typography>
                ) : null}

                {isLoadingRepos ? (
                  <Stack
                    direction="row"
                    spacing={1.5}
                    sx={{
                      alignItems: "center",
                      py: 2,
                      color: "text.secondary"
                    }}
                  >
                    <CircularProgress size={16} />
                    <Typography variant="body2">Loading popular repositories…</Typography>
                  </Stack>
                ) : null}

                {!isLoadingRepos && repos.length === 0 ? (
                  <Typography variant="body2" sx={{ color: "text.secondary", py: 2 }}>
                    No repositories found.
                  </Typography>
                ) : null}

                {!isLoadingRepos && repos.length > 0 ? (
                  <Box>
                    <List
                      dense
                      disablePadding
                      sx={{
                        maxHeight: 480,
                        overflowY: "auto",
                        mx: -1
                      }}
                    >
                      {repos.map((repo) => (
                        <ListItem key={repo.html_url} disablePadding>
                          <ListItemButton
                            component="a"
                            href={repo.html_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            sx={{
                              alignItems: "flex-start",
                              px: 1,
                              py: 0.75,
                              borderRadius: controlRadius
                            }}
                          >
                            <Stack spacing={0.25} sx={{ width: "100%", minWidth: 0 }}>
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  minWidth: 0
                                }}
                              >
                                <Typography
                                  component="span"
                                  variant="body1"
                                  noWrap
                                  sx={{
                                    fontWeight: 500
                                  }}
                                >
                                  {repo.name}
                                </Typography>
                                <Typography
                                  component="span"
                                  variant="caption"
                                  sx={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 0.25,
                                    flexShrink: 0,
                                    color: "text.secondary",
                                    "& .MuiSvgIcon-root": { fontSize: 14 }
                                  }}
                                >
                                  <StarBorderIcon />
                                  {repo.stargazers_count}
                                </Typography>
                              </Stack>
                              <Typography
                                variant="body2"
                                sx={{
                                  color: "text.secondary"
                                }}
                              >
                                {repo.description || "No description available"}
                              </Typography>
                            </Stack>
                          </ListItemButton>
                        </ListItem>
                      ))}
                    </List>
                  </Box>
                ) : null}
              </Stack>
            </Stack>
          </Stack>
        </Container>
      </Box>
    </MuiThemeProvider>
  );
}

export function bootstrapWelcomePage(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Welcome page root element not found");
  }

  const root = createRoot(container);
  root.render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <WelcomePageApp />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
