/* eslint-disable import-x/max-dependencies */
// Unified settings dialog: VS Code-style tree navigation on the left, section content on the right.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Collapse, Group, Modal, Stack, Text, UnstyledButton } from "@mantine/core";
import type { ModalProps } from "@mantine/core";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";

import type { CustomSettingsSection } from "../../../host";
import { AboutContent } from "../AboutModal";
import { ShortcutsSection } from "../lab-drawer/ShortcutsSection";
import { LabSettingsSection } from "../lab-drawer/LabSettingsSection";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";
import type { LabSettings, SettingsSection } from "../lab-settings";

import { ViewerGeneralTab } from "./ViewerGeneralTab";

interface SettingsModalProps extends GridSettingsControlsProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "view" | "edit";
  isLocked: boolean;
  labSettings?: LabSettings;
  initialSection?: SettingsSection;
  autoOpenOnInteraction: boolean;
  onToggleAutoOpen: () => void;
  /** Host-injected sections merged into the sidebar after the built-ins. */
  customSections?: CustomSettingsSection[];
  /** Whether the lab-specific sections (General/Mgmt/Appearance/Grid) are shown. */
  showLabSettings: boolean;
}

interface SectionEntry {
  id: string;
  label: string;
  testId: string;
}

interface SectionGroup {
  title: string;
  entries: SectionEntry[];
}

const DEFAULT_CUSTOM_GROUP = "Extensions";
// The canvas side panel uses z-index 1200 so it can sit above canvas overlays.
// Keep settings above that panel while remaining below transient notifications.
const SETTINGS_MODAL_Z_INDEX = 1400;

const SECTION_GROUPS: SectionGroup[] = [
  {
    title: "Lab",
    entries: [
      { id: "lab", label: "General", testId: "lab-settings-tab-basic" },
      { id: "mgmt", label: "Management Network", testId: "lab-settings-tab-mgmt" },
      { id: "appearance", label: "Appearance", testId: "lab-settings-tab-appearance" },
      { id: "grid", label: "Grid", testId: "lab-settings-tab-grid" }
    ]
  },
  {
    title: "TopoViewer",
    entries: [{ id: "general", label: "General", testId: "lab-settings-tab-general" }]
  },
  {
    title: "About",
    entries: [
      { id: "shortcuts", label: "Shortcuts", testId: "lab-settings-tab-shortcuts" },
      { id: "info", label: "Info", testId: "lab-settings-tab-info" }
    ]
  }
];

/** Sections whose edits are staged and written by the Apply button. */
const APPLYABLE_SECTIONS = new Set<string>(["lab", "mgmt", "appearance", "grid"]);

const SIDEBAR_WIDTH = 208;

/** Built-in groups with host sections appended to their group, or a new one. */
function buildGroups(
  customSections: CustomSettingsSection[],
  showLabSettings: boolean
): SectionGroup[] {
  const baseGroups = showLabSettings
    ? SECTION_GROUPS
    : SECTION_GROUPS.filter((group) => group.title !== "Lab");
  const groups: SectionGroup[] = baseGroups.map((group) => ({
    title: group.title,
    entries: [...group.entries]
  }));
  for (const custom of customSections) {
    const title = custom.group ?? DEFAULT_CUSTOM_GROUP;
    const entry: SectionEntry = {
      id: custom.id,
      label: custom.label,
      testId: `settings-tab-${custom.id}`
    };
    const existing = groups.find((group) => group.title === title);
    if (existing) {
      existing.entries.push(entry);
    } else {
      groups.push({ title, entries: [entry] });
    }
  }
  return groups;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  mode,
  isLocked,
  labSettings,
  initialSection = "lab",
  autoOpenOnInteraction,
  onToggleAutoOpen,
  customSections,
  showLabSettings,
  gridLineWidth,
  onGridLineWidthChange,
  gridStyle,
  onGridStyleChange,
  gridColor,
  onGridColorChange,
  gridBgColor,
  onGridBgColorChange,
  onResetGridColors
}) => {
  const groups = useMemo(
    () => buildGroups(customSections ?? [], showLabSettings),
    [customSections, showLabSettings]
  );
  const [section, setSection] = useState<string>(initialSection);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((title: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  }, []);
  const saveRef = useRef<(() => Promise<void>) | null>(null);
  const canSave = !isLocked && APPLYABLE_SECTIONS.has(section);
  const activeCustomSection = customSections?.find((custom) => custom.id === section);

  // If the lab sections are hidden (no lab open) but one is selected, fall back
  // to the always-available TopoViewer general section.
  useEffect(() => {
    if (!showLabSettings && APPLYABLE_SECTIONS.has(section)) {
      setSection("general");
    }
  }, [showLabSettings, section]);

  const handleSaveClick = useCallback(() => {
    const save = saveRef.current;
    if (!save) {
      return;
    }
    save().catch((error) => {
      console.error("Failed to save settings", error);
    });
  }, []);

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Settings"
      centered
      size={880}
      zIndex={SETTINGS_MODAL_Z_INDEX}
      data-testid="lab-settings-modal"
      closeButtonProps={
        { "data-testid": "lab-settings-close-btn" } as unknown as ModalProps["closeButtonProps"]
      }
      styles={{
        content: { height: "80vh" },
        body: {
          padding: 0,
          height: "calc(80vh - 56px)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }
      }}
    >
      <div style={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden" }}>
        <Box
          component="nav"
          aria-label="Settings sections"
          style={{
            width: SIDEBAR_WIDTH,
            flexShrink: 0,
            borderRight: "1px solid var(--mantine-color-default-border)",
            overflowY: "auto",
            backgroundColor: "var(--mantine-color-default-hover)"
          }}
        >
          <Stack gap={0} py={4}>
            {groups.map((group) => {
              const expanded = !collapsedGroups.has(group.title);
              return (
                <React.Fragment key={group.title}>
                  <UnstyledButton
                    onClick={() => toggleGroup(group.title)}
                    data-testid={`settings-group-${group.title.toLowerCase()}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 2,
                      padding: "2px 8px"
                    }}
                  >
                    <Text c="dimmed" span style={{ display: "inline-flex" }}>
                      {expanded ? (
                        <IconChevronDown size={18} />
                      ) : (
                        <IconChevronRight size={18} />
                      )}
                    </Text>
                    <Text size="sm" fw={600}>
                      {group.title}
                    </Text>
                  </UnstyledButton>
                  <Collapse in={expanded}>
                    <Stack gap={0}>
                      {group.entries.map((entry) => {
                        const selected = section === entry.id;
                        return (
                          <UnstyledButton
                            key={entry.id}
                            onClick={() => setSection(entry.id)}
                            data-testid={entry.testId}
                            style={{
                              padding: "4px 12px 4px 36px",
                              borderLeft: `2px solid ${
                                selected ? "var(--mantine-primary-color-filled)" : "transparent"
                              }`,
                              backgroundColor: selected
                                ? "var(--mantine-color-default-hover)"
                                : "transparent"
                            }}
                          >
                            <Text size="sm">{entry.label}</Text>
                          </UnstyledButton>
                        );
                      })}
                    </Stack>
                  </Collapse>
                </React.Fragment>
              );
            })}
          </Stack>
        </Box>

        <Box role="tabpanel" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          {section === "info" && <AboutContent />}

          {section === "shortcuts" && <ShortcutsSection />}

          {section === "general" && (
            <ViewerGeneralTab
              autoOpenOnInteraction={autoOpenOnInteraction}
              onToggleAutoOpen={onToggleAutoOpen}
            />
          )}

          {activeCustomSection ? <Box p="md">{activeCustomSection.render()}</Box> : null}

          {APPLYABLE_SECTIONS.has(section) && (
            <LabSettingsSection
              mode={mode}
              isLocked={isLocked}
              labSettings={labSettings}
              section={section as SettingsSection}
              onClose={onClose}
              saveRef={saveRef}
              gridLineWidth={gridLineWidth}
              onGridLineWidthChange={onGridLineWidthChange}
              gridStyle={gridStyle}
              onGridStyleChange={onGridStyleChange}
              gridColor={gridColor}
              onGridColorChange={onGridColorChange}
              gridBgColor={gridBgColor}
              onGridBgColorChange={onGridBgColorChange}
              onResetGridColors={onResetGridColors}
            />
          )}
        </Box>
      </div>
      {canSave && (
        <Group
          justify="flex-end"
          p="xs"
          style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
        >
          <Button size="xs" onClick={handleSaveClick} data-testid="lab-settings-save-btn">
            Apply
          </Button>
        </Group>
      )}
    </Modal>
  );
};
