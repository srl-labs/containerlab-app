import { IconExternalLink, IconStarFilled } from "@tabler/icons-react";
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Container,
  Divider,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title
} from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { AppThemeProvider } from "@srl-labs/clab-ui/theme";
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
    href: "https://github.com/srl-labs/vscode-containerlab/releases/"
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
    <AppThemeProvider>
      <div
        style={{
          width: "100%",
          height: "100%",
          overflowY: "auto",
          backgroundColor: "var(--mantine-color-body)",
          color: "var(--mantine-color-text)"
        }}
      >
        <Container size="xl" style={{ paddingTop: 24, paddingBottom: 24 }}>
          <Paper withBorder p="lg">
            <Stack gap={24}>
              <Group align="flex-start" gap={16} wrap="wrap">
                <img
                  src={containerlabLogo}
                  alt="Containerlab"
                  style={{
                    width: 64,
                    height: 64,
                    objectFit: "contain",
                    flexShrink: 0
                  }}
                />
                <Stack gap={8} style={{ minWidth: 0 }}>
                  <Title order={2} style={{ lineHeight: 1.2 }}>
                    Welcome to Containerlab
                  </Title>
                  <Group gap={8} wrap="wrap">
                    <Badge size="sm" variant="outline">{`Extension v${extensionVersion}`}</Badge>
                    {COMMUNITY_LINKS.map((link) => (
                      <Badge
                        key={link.label}
                        size="sm"
                        variant="outline"
                        component="a"
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        style={{ cursor: "pointer" }}
                        leftSection={<IconExternalLink size={12} />}
                      >
                        {link.label}
                      </Badge>
                    ))}
                  </Group>
                </Stack>
              </Group>

              <Divider />

              <Group align="stretch" gap={24} wrap="wrap">
                <Stack gap={24} style={{ flex: "1 1 55%", minWidth: 0 }}>
                  <Stack gap={12}>
                    <Title order={5}>Getting Started</Title>
                    <Text size="sm" c="dimmed">
                      The Containerlab extension integrates containerlab directly into VS Code,
                      providing an explorer for managing labs and containers.
                    </Text>
                    <Text size="sm" c="dimmed">
                      Create, deploy, and manage network topologies with just a few clicks.
                    </Text>
                    <Stack gap={6} align="flex-start">
                      <Button
                        onClick={() => {
                          postMessage({ command: "createExample" });
                        }}
                      >
                        Create Example Topology
                      </Button>
                      <Text size="xs" c="dimmed">
                        Creates `example.clab.yml` in your current workspace.
                      </Text>
                    </Stack>
                  </Stack>

                  <Stack gap={12}>
                    <Title order={5}>Documentation and Resources</Title>
                    <Stack gap={2}>
                      {RESOURCE_LINKS.map((link) => (
                        <Anchor
                          key={link.label}
                          href={link.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          size="sm"
                        >
                          {link.label}
                        </Anchor>
                      ))}
                    </Stack>

                    <Checkbox
                      checked={dontShowAgain}
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setDontShowAgain(checked);
                        postMessage({ command: "dontShowAgain", value: checked });
                      }}
                      label="Don't show this page again"
                    />
                  </Stack>
                </Stack>

                <Stack gap={12} style={{ flex: "1 1 45%", minWidth: 0 }}>
                  <Title order={5}>Popular Topologies</Title>

                  {usingFallback ? (
                    <Alert color="blue" variant="outline">
                      Using cached repository data due to GitHub API limits or temporary failures.
                    </Alert>
                  ) : null}

                  {isLoadingRepos ? (
                    <Group gap={12} align="center" style={{ paddingBlock: 16 }}>
                      <Loader size={18} />
                      <Text size="sm" c="dimmed">
                        Loading popular repositories...
                      </Text>
                    </Group>
                  ) : null}

                  {!isLoadingRepos && repos.length === 0 ? (
                    <Alert color="blue" variant="outline">
                      No repositories found.
                    </Alert>
                  ) : null}

                  {!isLoadingRepos && repos.length > 0 ? (
                    <div
                      style={{
                        maxHeight: 420,
                        overflowY: "auto",
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: "var(--mantine-radius-sm)"
                      }}
                    >
                      {repos.map((repo) => (
                        <Anchor
                          key={repo.html_url}
                          href={repo.html_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          underline="never"
                          c="inherit"
                          style={{
                            display: "block",
                            padding: 8,
                            borderBottom: "1px solid var(--mantine-color-default-border)"
                          }}
                        >
                          <Stack gap={4} style={{ width: "100%", minWidth: 0 }}>
                            <Group gap={8} align="center" style={{ minWidth: 0 }}>
                              <Text
                                span
                                size="sm"
                                style={{
                                  fontWeight: 600,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis"
                                }}
                              >
                                {repo.name}
                              </Text>
                              <Badge
                                size="sm"
                                variant="outline"
                                leftSection={
                                  <IconStarFilled
                                    size={12}
                                    style={{ color: "var(--mantine-color-yellow-6)" }}
                                  />
                                }
                              >
                                {repo.stargazers_count}
                              </Badge>
                            </Group>
                            <Text size="xs" c="dimmed">
                              {repo.description || "No description available"}
                            </Text>
                          </Stack>
                        </Anchor>
                      ))}
                    </div>
                  ) : null}
                </Stack>
              </Group>
            </Stack>
          </Paper>
        </Container>
      </div>
    </AppThemeProvider>
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
