// Help & feedback links, surfaced from the sidebar rail's (?) button.
// Migrated to Mantine as the first screen of the MUI -> Mantine migration.
import React from "react";
import { Card, Group, Modal, Stack, Text } from "@mantine/core";
import {
  IconBook,
  IconBrandGithub,
  IconExternalLink,
  IconMessageCircle,
  IconPuzzle
} from "@tabler/icons-react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface HelpLink {
  label: string;
  description: string;
  url: string;
  icon: React.ReactNode;
}

const HELP_LINKS: HelpLink[] = [
  {
    label: "Containerlab Documentation",
    description: "Full documentation",
    url: "https://containerlab.dev/",
    icon: <IconBook size={18} />
  },
  {
    label: "VS Code Extension Documentation",
    description: "VS Code extension guide",
    url: "https://containerlab.dev/manual/vsc-extension/",
    icon: <IconPuzzle size={18} />
  },
  {
    label: "Browse Labs on GitHub",
    description: "srl-labs organization",
    url: "https://github.com/srl-labs/",
    icon: <IconBrandGithub size={18} />
  },
  {
    label: "Join our Discord server",
    description: "Ask questions and share feedback",
    url: "https://discord.gg/vAyddtaEV9",
    icon: <IconMessageCircle size={18} />
  }
];

const LinkCard: React.FC<HelpLink> = ({ label, description, url, icon }) => (
  <Card
    withBorder
    radius="sm"
    padding="sm"
    component="a"
    href={url}
    target="_blank"
    rel="noopener noreferrer"
    style={{ textDecoration: "none", color: "inherit" }}
  >
    <Group wrap="nowrap" gap="sm" align="center">
      <Text c="dimmed" span style={{ display: "inline-flex" }}>
        {icon}
      </Text>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      </div>
      <Text c="dimmed" span style={{ display: "inline-flex" }}>
        <IconExternalLink size={18} />
      </Text>
    </Group>
  </Card>
);

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose }) => (
  <Modal
    opened={isOpen}
    onClose={onClose}
    title="Help & Feedback"
    size="lg"
    centered
  >
    <Stack gap="xs" data-testid="help-modal">
      {HELP_LINKS.map((link) => (
        <LinkCard key={link.url} {...link} />
      ))}
    </Stack>
  </Modal>
);
