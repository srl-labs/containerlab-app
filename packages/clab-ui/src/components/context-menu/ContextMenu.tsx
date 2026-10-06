// Context menu dropdown at a given position.
import React, { useCallback } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";

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

/** Compact menus cap their width; submenus flip left when this much room is missing on the right. */
const COMPACT_MAX_WIDTH = 260;
/** Border plus list padding, so a submenu's first row lines up with its parent row. */
const SUBMENU_OFFSET = "5px";

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
function submenuOpensLeft(anchor: HTMLElement): boolean {
  const rect = anchor.getBoundingClientRect();
  const roomRight = window.innerWidth - rect.right;
  return roomRight < COMPACT_MAX_WIDTH && rect.left > roomRight;
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
      <ListItemText slotProps={{ primary: { noWrap: true } }}>{item.label}</ListItemText>
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
