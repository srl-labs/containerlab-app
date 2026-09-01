/* eslint-disable import-x/max-dependencies */
// Icon selector modal.
import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import { IconReload, IconX } from "@tabler/icons-react";
import { ActionIcon, Box, Button, Divider, Modal, Tabs, Text, Tooltip } from "@mantine/core";

import type { NodeType } from "../../icons/SvgGenerator";
import { generateEncodedSVG } from "../../icons/SvgGenerator";
import { useEscapeKey } from "../../hooks/ui/useDomInteractions";
import { useCustomIcons } from "../../stores/topoViewerStore";
import { useClabUiHost } from "../../host";
import { isBuiltInIcon } from "../../core/types/icons";
import { DEFAULT_ICON_COLOR } from "../../core/types/graph";

import { DialogCancelSaveActions } from "./dialog/DialogChrome";
import { ColorField, IconPreview, InputField } from "./form";

const AVAILABLE_ICONS: NodeType[] = [
  "pe",
  "dcgw",
  "leaf",
  "switch",
  "bridge",
  "spine",
  "super-spine",
  "server",
  "pon",
  "controller",
  "rgw",
  "ue",
  "cloud",
  "client"
];

const ICON_LABELS: Record<string, string> = {
  pe: "PE Router",
  dcgw: "DC Gateway",
  leaf: "Leaf",
  switch: "Switch",
  bridge: "Bridge",
  spine: "Spine",
  "super-spine": "Super Spine",
  server: "Server",
  pon: "PON",
  controller: "Controller",
  rgw: "RGW",
  ue: "User Equipment",
  cloud: "Cloud",
  client: "Client"
};

const DEFAULT_COLOR = DEFAULT_ICON_COLOR;
const MAX_RADIUS = 40;
const COLOR_DEBOUNCE_MS = 50;
const NODE_TYPE_SET: ReadonlySet<string> = new Set(AVAILABLE_ICONS);

function isNodeType(value: string): value is NodeType {
  return NODE_TYPE_SET.has(value);
}

function isIconTab(value: unknown): value is "built-in" | "custom" {
  return value === "built-in" || value === "custom";
}

const IconsGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box
    style={{
      display: "grid",
      gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
      gap: 4,
      borderRadius: 2,
      border: "1px solid var(--mantine-color-default-border)",
      padding: 8
    }}
  >
    {children}
  </Box>
);

/**
 * Get icon source - for built-in icons applies color, for custom icons returns as-is
 */
function getIconSrc(icon: string, color: string, customIconDataUri?: string): string {
  // Custom icons render as-is (no color tinting)
  if (customIconDataUri !== undefined && customIconDataUri.length > 0) {
    return customIconDataUri;
  }
  // Built-in icons with color
  try {
    return generateEncodedSVG(isNodeType(icon) ? icon : "pe", color);
  } catch {
    return generateEncodedSVG("pe", color);
  }
}

/**
 * Hook to debounce a value - returns debounced value that updates after delay
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

interface UseIconSelectorStateReturn {
  icon: string;
  setIcon: (icon: string) => void;
  color: string;
  setColor: (color: string) => void;
  radius: number;
  setRadius: (radius: number) => void;
  resultColor: string | null;
}

/**
 * Hook to manage icon selector form state
 */
function useIconSelectorState(
  isOpen: boolean,
  initialIcon: string,
  initialColor: string | null,
  initialCornerRadius: number
): UseIconSelectorStateReturn {
  const [icon, setIcon] = useState(initialIcon);
  const [color, setColor] = useState(initialColor ?? DEFAULT_COLOR);
  const [radius, setRadius] = useState(initialCornerRadius);

  useEffect(() => {
    if (isOpen) {
      setIcon(initialIcon);
      setColor(initialColor ?? DEFAULT_COLOR);
      setRadius(initialCornerRadius);
    }
  }, [isOpen, initialIcon, initialColor, initialCornerRadius]);

  const resultColor = color !== DEFAULT_COLOR ? color : null;

  return {
    icon,
    setIcon,
    color,
    setColor,
    radius,
    setRadius,
    resultColor
  };
}

interface IconSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (icon: string, color: string | null, cornerRadius: number) => void;
  initialIcon?: string;
  initialColor?: string | null;
  initialCornerRadius?: number;
}

interface IconButtonProps {
  icon: string;
  isSelected: boolean;
  iconSrc: string;
  cornerRadius: number;
  onClick: () => void;
  onDelete?: () => void;
  isCustom?: boolean;
  source?: "workspace" | "global";
}

const IconButton = React.memo<IconButtonProps>(function IconButton({
  icon,
  isSelected,
  iconSrc,
  cornerRadius,
  onClick,
  onDelete,
  isCustom,
  source
}) {
  const showDeleteButton = isCustom === true && source === "global" && onDelete !== undefined;
  const handleDelete = onDelete ?? (() => undefined);
  const [hovered, setHovered] = useState(false);
  const backgroundColor =
    isSelected || hovered ? "var(--mantine-color-default-hover)" : "transparent";
  return (
    <Box
      style={{ position: "relative", minWidth: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Box
        component="button"
        type="button"
        onClick={onClick}
        aria-pressed={isSelected}
        title={(ICON_LABELS[icon] || icon) + (source ? " (" + source + ")" : "")}
        style={{
          display: "flex",
          width: "100%",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          borderRadius: 2,
          padding: 6,
          overflow: "hidden",
          transition: "background-color 150ms",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          backgroundColor,
          outline: isSelected ? "2px solid var(--mantine-primary-color-filled)" : "none",
          outlineOffset: 1
        }}
      >
        <IconPreview src={iconSrc} alt={icon} size={36} cornerRadius={cornerRadius} />
        <Box
          component="span"
          style={{
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "10px"
          }}
        >
          {ICON_LABELS[icon] || icon}
        </Box>
      </Box>
      {/* Delete button for global custom icons */}
      {showDeleteButton && (
        <ActionIcon
          size={16}
          color="red"
          variant="filled"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
          title={`Delete ${icon}`}
          className="icon-delete-btn"
          style={{
            position: "absolute",
            top: -4,
            right: -4,
            opacity: hovered ? 1 : 0
          }}
        >
          <IconX size={12} />
        </ActionIcon>
      )}
    </Box>
  );
});

const RadiusField: React.FC<{ value: number; onChange: (v: number) => void }> = ({
  value,
  onChange
}) => (
  <InputField
    id="icon-corner-radius"
    label="Corner Radius"
    type="number"
    value={String(value)}
    onChange={(v) => {
      const n = parseInt(v, 10);
      if (!isNaN(n)) onChange(Math.max(0, Math.min(MAX_RADIUS, n)));
      else if (v === "") onChange(0);
    }}
    min={0}
    max={MAX_RADIUS}
    step={1}
    suffix="px"
  />
);

export const IconSelectorModal: React.FC<IconSelectorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialIcon = "pe",
  initialColor = null,
  initialCornerRadius = 0
}) => {
  const customIcons = useCustomIcons();
  const { topoViewer } = useClabUiHost();

  const { icon, setIcon, color, setColor, radius, setRadius, resultColor } = useIconSelectorState(
    isOpen,
    initialIcon,
    initialColor,
    initialCornerRadius
  );

  useEscapeKey(isOpen, onClose);

  // Debounce color for icon grid to reduce SVG regeneration during color picker drag
  const debouncedGridColor = useDebouncedValue(color, COLOR_DEBOUNCE_MS);

  // Check if current icon is a custom icon
  const currentCustomIcon = useMemo(() => {
    return customIcons.find((ci) => ci.name === icon);
  }, [customIcons, icon]);

  // Memoize icon sources for built-in icons - only regenerate when debounced color changes
  const iconSources = useMemo(() => {
    const sources: Record<string, string> = {};
    for (const i of AVAILABLE_ICONS) {
      sources[i] = getIconSrc(i, debouncedGridColor);
    }
    return sources;
  }, [debouncedGridColor]);

  // Memoize click/delete handlers to prevent IconButton re-renders
  const iconClickHandlers = useRef<Record<string, () => void>>({});
  const iconDeleteHandlers = useRef<Record<string, () => void>>({});
  useMemo(() => {
    for (const i of AVAILABLE_ICONS) {
      iconClickHandlers.current[i] = () => setIcon(i);
    }
    // Add handlers for custom icons
    for (const ci of customIcons) {
      iconClickHandlers.current[ci.name] = () => setIcon(ci.name);
      iconDeleteHandlers.current[ci.name] = () => topoViewer.deleteIcon(ci.name);
    }
  }, [setIcon, topoViewer, customIcons]);

  const handleSave = useCallback(() => {
    onSave(icon, resultColor, radius);
    onClose();
  }, [icon, resultColor, radius, onSave, onClose]);

  const handleUploadIcon = useCallback(() => {
    topoViewer.uploadIcon();
  }, [topoViewer]);

  // Get preview icon source
  const previewIconSrc = useMemo(() => {
    if (currentCustomIcon) {
      return currentCustomIcon.dataUri;
    }
    return getIconSrc(icon, color);
  }, [icon, color, currentCustomIcon]);

  const [iconTab, setIconTab] = useState<"built-in" | "custom">("built-in");

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="Edit Icons"
      size="md"
      centered
      styles={{ body: { padding: 0 } }}
    >
      <Box style={{ display: "flex", flexDirection: "column" }}>
        {/* Icon tabs */}
        <Tabs
          value={iconTab}
          onChange={(v) => {
            if (isIconTab(v)) {
              setIconTab(v);
            }
          }}
        >
          <Tabs.List grow>
            <Tabs.Tab value="built-in">Built-in</Tabs.Tab>
            <Tabs.Tab value="custom">Custom</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <Divider />

        {/* Built-in Icons tab content */}
        {iconTab === "built-in" && (
          <Box style={{ padding: 16 }}>
            <IconsGrid>
              {AVAILABLE_ICONS.map((i) => (
                <IconButton
                  key={i}
                  icon={i}
                  isSelected={icon === i}
                  iconSrc={iconSources[i]}
                  cornerRadius={radius}
                  onClick={iconClickHandlers.current[i]}
                />
              ))}
            </IconsGrid>
          </Box>
        )}

        {/* Custom Icons tab content */}
        {iconTab === "custom" && (
          <Box style={{ padding: 16 }}>
            {customIcons.length > 0 ? (
              <Box style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <IconsGrid>
                  {customIcons.map((ci) => (
                    <IconButton
                      key={ci.name}
                      icon={ci.name}
                      isSelected={icon === ci.name}
                      iconSrc={ci.dataUri}
                      cornerRadius={radius}
                      onClick={iconClickHandlers.current[ci.name]}
                      onDelete={iconDeleteHandlers.current[ci.name]}
                      isCustom={true}
                      source={ci.source}
                    />
                  ))}
                </IconsGrid>
                <Button fullWidth size="xs" variant="subtle" onClick={handleUploadIcon}>
                  + Add Icon
                </Button>
              </Box>
            ) : (
              <Box
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 12,
                  paddingTop: 16,
                  paddingBottom: 16
                }}
              >
                <Text size="xs" c="dimmed" style={{ fontStyle: "italic" }}>
                  No custom icons uploaded yet.
                </Text>
                <Button fullWidth size="xs" variant="subtle" onClick={handleUploadIcon}>
                  + Add Icon
                </Button>
              </Box>
            )}
          </Box>
        )}

        {/* Appearance section */}
        <Divider />
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={600}>
            Appearance
          </Text>
        </Box>
        <Divider />
        <Box style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16 }}>
          <Tooltip
            label="Color cannot be modified for custom icons"
            position="top"
            disabled={isBuiltInIcon(icon)}
          >
            <Box style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Box style={{ flex: 1 }}>
                <ColorField
                  label="Icon Color"
                  value={color}
                  onChange={(v) => setColor(v)}
                  disabled={!isBuiltInIcon(icon)}
                />
              </Box>
              <Tooltip label="Reset to default color" position="top">
                <span>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    onClick={() => setColor(DEFAULT_ICON_COLOR)}
                    disabled={!isBuiltInIcon(icon) || color === DEFAULT_ICON_COLOR}
                  >
                    <IconReload size={18} />
                  </ActionIcon>
                </span>
              </Tooltip>
            </Box>
          </Tooltip>
          <RadiusField value={radius} onChange={setRadius} />
        </Box>

        {/* Preview section */}
        <Divider />
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={600}>
            Preview
          </Text>
        </Box>
        <Divider />
        <Box style={{ padding: 16, display: "flex", justifyContent: "center" }}>
          <IconPreview src={previewIconSrc} alt="Preview" size={56} cornerRadius={radius} />
        </Box>
      </Box>
      <DialogCancelSaveActions onCancel={onClose} onSave={handleSave} />
    </Modal>
  );
};
