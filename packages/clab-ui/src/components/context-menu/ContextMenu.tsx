// Context menu dropdown at a given position.
import React, { useCallback } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Why the item is disabled, shown under its label, e.g. what a Kubernetes lab host lacks. */
  disabledReason?: string;
  divider?: boolean;
  danger?: boolean;
  onClick?: () => void;
  children?: ContextMenuItem[];
  /** Custom submenu content, such as a checklist; `close` closes the whole menu. */
  panel?: (close: () => void) => React.ReactNode;
  /** Accessible name of the panel; defaults to the label. */
  panelLabel?: string;
  /** Keys that do the same, shown right-aligned, e.g. "Ctrl+D" */
  shortcut?: string;
}

/** Compact menus cap their width; submenus flip left when this much room is missing on the right. */
const COMPACT_MAX_WIDTH = 260;
/** Border plus list padding, so a submenu's first row lines up with its parent row. */
const SUBMENU_OFFSET = "5px";
/** Panels are wider than menus; they flip left when this much room is missing on the right. */
const PANEL_MAX_WIDTH = 380;
/** Grace period before a panel closes once the pointer rests on another row. */
const PANEL_CLOSE_DELAY_MS = 200;

function menuPaperSx(compact: boolean) {
  return compact ? { minWidth: 160, maxWidth: COMPACT_MAX_WIDTH } : { minWidth: 180 };
}

/** Dividers only ever sit between two groups: never first, last or doubled. */
function withoutStrayDividers(items: ContextMenuItem[]): ContextMenuItem[] {
  return items.filter((item, index) => {
    if (item.divider !== true) return true;
    const next = items[index + 1] as ContextMenuItem | undefined;
    return index > 0 && items[index - 1].divider !== true && next !== undefined && next.divider !== true;
  });
}

/** Submenus open to the right like native menus, and only flip when the window edge is too close. */
function submenuOpensLeft(anchor: HTMLElement, width = COMPACT_MAX_WIDTH): boolean {
  const rect = anchor.getBoundingClientRect();
  const roomRight = window.innerWidth - rect.right;
  return roomRight < width && rect.left > roomRight;
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

export const ContextMenu: React.FC<ContextMenuProps> = ({
  isVisible,
  position,
  items,
  onClose,
  onBackdropContextMenu,
  compact = false,
  openSubmenuOnHover = true,
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

  return (
    <Menu
      open={isVisible}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: position.y, left: position.x }}
      transformOrigin={{
        vertical: "top",
        horizontal: openToLeft ? "right" : "left"
      }}
      data-testid="context-menu"
      slotProps={{
        backdrop: {
          invisible: true,
          onContextMenu: handleBackdropContextMenu
        },
        paper: {
          sx: menuPaperSx(compact),
          onContextMenu: suppressNativeMenu
        }
      }}
    >
      {withoutStrayDividers(items).map((item) => {
        if (item.divider === true) {
          return <Divider key={item.id} />;
        }
        if (item.panel) {
          return (
            <MenuItemWithPanel
              key={item.id}
              item={item}
              onClose={onClose}
              openSubmenuOnHover={openSubmenuOnHover}
            />
          );
        }
        if (item.children && item.children.length > 0) {
          return (
            <MenuItemWithSubmenu
              key={item.id}
              item={item}
              onClose={onClose}
              compact={compact}
              openSubmenuOnHover={openSubmenuOnHover}
            />
          );
        }
        return <MenuItemButton key={item.id} item={item} onClose={onClose} />;
      })}
    </Menu>
  );
};

/**
 * Individual menu item component
 */
interface MenuItemComponentProps {
  item: ContextMenuItem;
  onClose: () => void;
  compact?: boolean;
  openSubmenuOnHover?: boolean;
}

function useMenuItemClick(item: ContextMenuItem, onClose: () => void) {
  return useCallback(() => {
    if (item.disabled !== true && item.onClick !== undefined) {
      item.onClick();
      onClose();
    }
  }, [item, onClose]);
}

function handleSubmenuMouseEnter(params: {
  event: React.MouseEvent<HTMLElement>;
  openSubmenuOnHover: boolean;
  cancelClose: () => void;
  setAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
}) {
  const { event, openSubmenuOnHover, cancelClose, setAnchorEl } = params;
  if (!openSubmenuOnHover) {
    return;
  }
  cancelClose();
  setAnchorEl(event.currentTarget);
}

function handleSubmenuItemClick(item: ContextMenuItem, onClose: () => void): void {
  if (item.disabled !== true && item.onClick !== undefined) {
    item.onClick();
    onClose();
  }
}

function handleSubmenuToggleClick(params: {
  event: React.MouseEvent<HTMLElement>;
  openSubmenuOnHover: boolean;
  disabled?: boolean;
  hasClickHandler: boolean;
  cancelClose: () => void;
  setAnchorEl: React.Dispatch<React.SetStateAction<HTMLElement | null>>;
}) {
  const { event, openSubmenuOnHover, disabled, hasClickHandler, cancelClose, setAnchorEl } = params;
  if (openSubmenuOnHover || disabled === true || hasClickHandler) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  cancelClose();
  setAnchorEl((current) => (current ? null : event.currentTarget));
}

function renderSubmenuChild(params: {
  child: ContextMenuItem;
  onClose: () => void;
  compact: boolean;
  openSubmenuOnHover: boolean;
}): React.ReactElement {
  const { child, onClose, compact, openSubmenuOnHover } = params;
  if (child.divider === true) {
    return <Divider key={child.id} />;
  }
  if (child.panel) {
    return (
      <MenuItemWithPanel
        key={child.id}
        item={child}
        onClose={onClose}
        openSubmenuOnHover={openSubmenuOnHover}
      />
    );
  }
  if (child.children && child.children.length > 0) {
    return (
      <MenuItemWithSubmenu
        key={child.id}
        item={child}
        onClose={onClose}
        compact={compact}
        openSubmenuOnHover={openSubmenuOnHover}
      />
    );
  }
  return <MenuItemButton key={child.id} item={child} onClose={onClose} />;
}

function resolveSubmenuClickHandler(
  hasClickHandler: boolean,
  handleClick: (event: React.MouseEvent<HTMLElement>) => void,
  handleOpenSubmenuByClick: (event: React.MouseEvent<HTMLElement>) => void
): (event: React.MouseEvent<HTMLElement>) => void {
  if (hasClickHandler) {
    return handleClick;
  }
  return handleOpenSubmenuByClick;
}

function renderMenuItemLabel(item: ContextMenuItem): React.ReactElement {
  const hasIcon = item.icon !== undefined && item.icon !== null;
  return (
    <>
      {hasIcon && <ListItemIcon>{item.icon}</ListItemIcon>}
      <ListItemText
        slotProps={{ primary: { noWrap: true }, secondary: { sx: { fontSize: 11, whiteSpace: "normal" } } }}
        {...(item.disabled === true && item.disabledReason !== undefined ? { secondary: item.disabledReason } : {})}
      >
        {item.label}
      </ListItemText>
      {item.shortcut !== undefined && (
        <Typography variant="body2" sx={{ ml: 3, color: "text.secondary", flexShrink: 0 }}>
          {item.shortcut}
        </Typography>
      )}
    </>
  );
}

/** Destructive rows read red as a whole, icon included. */
const DANGER_ITEM_SX = { color: "error.main", "& .MuiListItemIcon-root": { color: "inherit" } } as const;

const MenuItemButton: React.FC<MenuItemComponentProps> = ({ item, onClose }) => {
  const handleClick = useMenuItemClick(item, onClose);

  return (
    <MenuItem
      onClick={handleClick}
      disabled={item.disabled}
      data-testid={`context-menu-item-${item.id}`}
      sx={item.danger === true ? DANGER_ITEM_SX : undefined}
    >
      {renderMenuItemLabel(item)}
    </MenuItem>
  );
};

const MenuItemWithSubmenu: React.FC<MenuItemComponentProps> = ({
  item,
  onClose,
  compact = false,
  openSubmenuOnHover = true
}) => {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const submenuOpen = Boolean(anchorEl);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setAnchorEl(null), 100);
  }, [cancelClose]);

  React.useEffect(() => () => cancelClose(), [cancelClose]);

  const handleMouseEnter = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      handleSubmenuMouseEnter({
        event,
        openSubmenuOnHover,
        cancelClose,
        setAnchorEl
      });
    },
    [cancelClose, openSubmenuOnHover]
  );

  const handleClick = useCallback(
    (_event: React.MouseEvent<HTMLElement>) => {
      handleSubmenuItemClick(item, onClose);
    },
    [item, onClose]
  );

  const handleOpenSubmenuByClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      handleSubmenuToggleClick({
        event,
        openSubmenuOnHover,
        disabled: item.disabled,
        hasClickHandler: Boolean(item.onClick),
        cancelClose,
        setAnchorEl
      });
    },
    [cancelClose, item.disabled, item.onClick, openSubmenuOnHover]
  );

  const renderChild = useCallback(
    (child: ContextMenuItem) =>
      renderSubmenuChild({
        child,
        onClose,
        compact,
        openSubmenuOnHover
      }),
    [compact, onClose, openSubmenuOnHover]
  );

  const clickHandler = resolveSubmenuClickHandler(
    Boolean(item.onClick),
    handleClick,
    handleOpenSubmenuByClick
  );
  const opensLeft = anchorEl !== null && submenuOpensLeft(anchorEl);

  return (
    <>
      <MenuItem
        onMouseEnter={handleMouseEnter}
        onMouseLeave={scheduleClose}
        onClick={clickHandler}
        disabled={item.disabled}
        data-testid={`context-menu-item-${item.id}`}
        // Keep the parent row lit while its submenu is open.
        sx={submenuOpen ? { bgcolor: "action.hover" } : undefined}
      >
        {renderMenuItemLabel(item)}
        <ChevronRightRoundedIcon
          aria-hidden="true"
          sx={{ fontSize: 16, ml: 1.5, mr: -0.5, color: "text.secondary" }}
        />
      </MenuItem>
      <Menu
        anchorEl={anchorEl}
        open={submenuOpen}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{
          vertical: "top",
          horizontal: opensLeft ? "left" : "right"
        }}
        transformOrigin={{
          vertical: "top",
          horizontal: opensLeft ? "right" : "left"
        }}
        hideBackdrop
        sx={{ pointerEvents: "none" }}
        slotProps={{
          paper: {
            sx: {
              ...menuPaperSx(compact),
              pointerEvents: "auto",
              mt: `-${SUBMENU_OFFSET}`,
              ml: opensLeft ? `-${SUBMENU_OFFSET}` : SUBMENU_OFFSET
            },
            onMouseEnter: cancelClose,
            onMouseLeave: scheduleClose
          }
        }}
      >
        {withoutStrayDividers(item.children ?? []).map(renderChild)}
      </Menu>
    </>
  );
};

/** True when a click came from the keyboard (Enter or Space on the row), not the pointer. */
function isKeyboardActivation(event: React.SyntheticEvent): boolean {
  return event.type !== "click" || (event as React.MouseEvent).detail === 0;
}

/** The panel's marked starting point, else its first control, so a keyboard user lands on the content. */
function focusFirstControl(root: HTMLElement | null): void {
  const target =
    root?.querySelector<HTMLElement>("[data-autofocus]") ??
    root?.querySelector<HTMLElement>('input:not([type="hidden"]), button:not([disabled])');
  target?.focus();
}

/**
 * A row that opens custom content beside the menu. Like native submenus it
 * opens on hover, click, Enter or ArrowRight; unlike a list it stays open while
 * the pointer wanders off, and closes once it rests on another row, on Escape
 * or ArrowLeft.
 */
const MenuItemWithPanel: React.FC<MenuItemComponentProps> = ({
  item,
  onClose,
  openSubmenuOnHover = true
}) => {
  const rowRef = React.useRef<HTMLLIElement | null>(null);
  const paperRef = React.useRef<HTMLDivElement | null>(null);
  const openedByKeyboard = React.useRef(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = React.useState(false);
  const [opensLeft, setOpensLeft] = React.useState(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const closePanel = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);

  const openPanel = useCallback(
    (byKeyboard: boolean) => {
      const row = rowRef.current;
      if (item.disabled === true || !row) return;
      cancelClose();
      openedByKeyboard.current = byKeyboard;
      setOpensLeft(submenuOpensLeft(row, PANEL_MAX_WIDTH));
      setOpen(true);
    },
    [cancelClose, item.disabled]
  );

  React.useEffect(() => () => cancelClose(), [cancelClose]);

  // Close once the pointer rests on another row of this menu; the gaps between
  // rows and the space outside both menus keep the panel open.
  React.useEffect(() => {
    const row = rowRef.current;
    const list = row?.parentElement;
    if (!open || !row || !list) return undefined;
    const handleMouseOver = (event: MouseEvent) => {
      const hovered = event.target instanceof Element ? event.target.closest("li, hr") : null;
      if (!hovered || hovered === list || !list.contains(hovered)) return;
      cancelClose();
      if (hovered !== row) closeTimer.current = setTimeout(closePanel, PANEL_CLOSE_DELAY_MS);
    };
    list.addEventListener("mouseover", handleMouseOver);
    return () => list.removeEventListener("mouseover", handleMouseOver);
  }, [cancelClose, closePanel, open]);

  const handleRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLLIElement>) => {
      if (event.key !== "ArrowRight") return;
      event.preventDefault();
      openPanel(true);
    },
    [openPanel]
  );

  // Keys stay inside the panel: the parent list would otherwise treat typing
  // and arrows as its own navigation, and Tab would close the whole menu.
  const handlePanelKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      event.stopPropagation();
      const target = event.target;
      const inTextField =
        target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "radio";
      if (event.key === "ArrowLeft" && !inTextField) {
        event.preventDefault();
        closePanel();
        rowRef.current?.focus();
      }
    },
    [closePanel]
  );

  return (
    <>
      <MenuItem
        ref={rowRef}
        onMouseEnter={openSubmenuOnHover ? () => openPanel(false) : undefined}
        onClick={(event) => openPanel(isKeyboardActivation(event))}
        onKeyDown={handleRowKeyDown}
        disabled={item.disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid={`context-menu-item-${item.id}`}
        // Keep the parent row lit while its panel is open.
        sx={open ? { bgcolor: "action.hover" } : undefined}
      >
        {renderMenuItemLabel(item)}
        <ChevronRightRoundedIcon
          aria-hidden="true"
          sx={{ fontSize: 16, ml: 1.5, mr: -0.5, color: "text.secondary" }}
        />
      </MenuItem>
      <Popover
        open={open}
        anchorEl={rowRef.current}
        onClose={closePanel}
        anchorOrigin={{ vertical: "top", horizontal: opensLeft ? "left" : "right" }}
        transformOrigin={{ vertical: "top", horizontal: opensLeft ? "right" : "left" }}
        hideBackdrop
        onKeyDown={handlePanelKeyDown}
        sx={{ pointerEvents: "none" }}
        slotProps={{
          paper: {
            ref: paperRef,
            role: "dialog",
            "aria-label": item.panelLabel ?? item.label,
            onMouseEnter: cancelClose,
            sx: {
              pointerEvents: "auto",
              mt: `-${SUBMENU_OFFSET}`,
              ml: opensLeft ? `-${SUBMENU_OFFSET}` : SUBMENU_OFFSET
            }
          },
          transition: {
            onEntered: () => {
              if (openedByKeyboard.current) focusFirstControl(paperRef.current);
            }
          }
        }}
      >
        {item.panel?.(onClose)}
      </Popover>
    </>
  );
};
