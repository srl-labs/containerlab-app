// Context menu dropdown at a given position.
import React, { useCallback } from "react";
import { Menu, Portal } from "@mantine/core";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  divider?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children?: ContextMenuItem[];
}

interface ContextMenuProps {
  isVisible: boolean;
  position: { x: number; y: number };
  items: ContextMenuItem[];
  onClose: () => void;
  onBackdropContextMenu?: (event: React.MouseEvent) => void;
  compact?: boolean;
  openSubmenuOnHover?: boolean;
  openToLeft?: boolean;
}

const MENU_Z_INDEX = 1400;
const BACKDROP_Z_INDEX = 1350;

function itemStyle(compact: boolean): React.CSSProperties | undefined {
  if (!compact) return undefined;
  return {
    minHeight: 28,
    paddingTop: 2,
    paddingBottom: 2,
    paddingLeft: 8,
    paddingRight: 8,
    fontSize: 12.5,
    lineHeight: 1.25
  };
}

function dividerStyle(compact: boolean): React.CSSProperties | undefined {
  return compact ? { marginTop: 1, marginBottom: 1 } : undefined;
}

interface RenderOptions {
  compact: boolean;
  openToLeft: boolean;
  onClose: () => void;
}

function renderContextMenuItem(item: ContextMenuItem, options: RenderOptions): React.ReactElement {
  const { compact, openToLeft, onClose } = options;

  if (item.divider === true) {
    return <Menu.Divider key={item.id} style={dividerStyle(compact)} />;
  }

  if (item.children && item.children.length > 0) {
    const handleParentClick = item.onClick
      ? () => {
          if (item.disabled !== true) {
            item.onClick?.();
            onClose();
          }
        }
      : undefined;
    return (
      <Menu.Sub key={item.id} position={openToLeft ? "left-start" : "right-start"}>
        <Menu.Sub.Target>
          <Menu.Sub.Item
            leftSection={item.icon}
            disabled={item.disabled}
            onClick={handleParentClick}
            data-testid={`context-menu-item-${item.id}`}
            style={itemStyle(compact)}
          >
            {item.label}
          </Menu.Sub.Item>
        </Menu.Sub.Target>
        <Menu.Sub.Dropdown
          style={{ minWidth: 150, maxWidth: compact ? 240 : undefined }}
        >
          {item.children.map((child) => renderContextMenuItem(child, options))}
        </Menu.Sub.Dropdown>
      </Menu.Sub>
    );
  }

  return (
    <Menu.Item
      key={item.id}
      leftSection={item.icon}
      color={item.danger === true ? "red" : undefined}
      disabled={item.disabled}
      onClick={() => {
        item.onClick?.();
        onClose();
      }}
      data-testid={`context-menu-item-${item.id}`}
      style={itemStyle(compact)}
    >
      {item.label}
    </Menu.Item>
  );
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isVisible,
  position,
  items,
  onClose,
  onBackdropContextMenu,
  compact = false,
  openToLeft = false
}) => {
  const handleBackdropContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (onBackdropContextMenu) {
        onBackdropContextMenu(e);
      } else {
        onClose();
      }
    },
    [onClose, onBackdropContextMenu]
  );

  const suppressNativeMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      onClose();
    },
    [onClose]
  );

  if (!isVisible || items.length === 0) return null;

  const options: RenderOptions = { compact, openToLeft, onClose };

  return (
    <>
      {/* Invisible full-screen layer that relays right-clicks (repositioning the
          menu) while it is open, mirroring the old MUI modal backdrop. */}
      <Portal>
        <div
          style={{ position: "fixed", inset: 0, zIndex: BACKDROP_Z_INDEX }}
          onContextMenu={handleBackdropContextMenu}
        />
      </Portal>
      <Menu
        opened={isVisible}
        onClose={onClose}
        position={openToLeft ? "bottom-end" : "bottom-start"}
        offset={0}
        zIndex={MENU_Z_INDEX}
        withinPortal
      >
        <Menu.Target>
          <div
            style={{
              position: "fixed",
              top: position.y,
              left: position.x,
              width: 0,
              height: 0,
              pointerEvents: "none"
            }}
          />
        </Menu.Target>
        <Menu.Dropdown
          data-testid="context-menu"
          onContextMenu={suppressNativeMenu}
          style={{
            minWidth: compact ? 150 : 180,
            maxWidth: compact ? 248 : undefined
          }}
        >
          {items.map((item) => renderContextMenuItem(item, options))}
        </Menu.Dropdown>
      </Menu>
    </>
  );
};
