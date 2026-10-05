import { type MouseEvent, useCallback, useState } from "react";
import type { ExplorerAction, ExplorerNode } from "../shared/explorer/types";

export function useExplorerNodeMenu(params: { hasActions: boolean; hasContextMenuItems: boolean }) {
  const { hasActions, hasContextMenuItems } = params;
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const [menuOpenToLeft, setMenuOpenToLeft] = useState(false);

  const openMenuFromElement = useCallback((element: HTMLElement, openToLeft = true) => {
    const rect = element.getBoundingClientRect();
    setMenuOpenToLeft(openToLeft);
    setMenuPosition({ x: Math.round(rect.right), y: Math.round(rect.bottom + 2) });
  }, []);

  const handleMenuOpen = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!hasActions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openMenuFromElement(event.currentTarget, true);
    },
    [hasActions, openMenuFromElement]
  );

  const handleRowContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!hasActions) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const trigger = event.currentTarget.querySelector<HTMLElement>(
        '[data-node-actions-trigger="true"]'
      );
      openMenuFromElement(trigger ?? event.currentTarget, true);
    },
    [hasActions, openMenuFromElement]
  );

  const handleMenuClose = useCallback(() => {
    setMenuOpenToLeft(false);
    setMenuPosition(null);
  }, []);

  const handleBackdropContextMenu = useCallback(
    (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const relayTarget = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map((element) => element.closest<HTMLElement>('[data-explorer-node-row="true"]'))
        .find((element): element is HTMLElement => Boolean(element));
      if (!relayTarget) {
        return;
      }

      handleMenuClose();
      relayTarget.dispatchEvent(
        new window.MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          button: 2,
          buttons: 2
        })
      );
    },
    [handleMenuClose]
  );

  const menuOpen = Boolean(menuPosition) && hasContextMenuItems;

  return {
    menuPosition,
    menuOpenToLeft,
    menuOpen,
    handleMenuOpen,
    handleRowContextMenu,
    handleMenuClose,
    handleBackdropContextMenu
  };
}

export function usePrimaryActionHandler(
  primaryAction: ExplorerNode["primaryAction"],
  onInvokeAction: (action: ExplorerAction) => void
) {
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!primaryAction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInvokeAction(primaryAction);
    },
    [primaryAction, onInvokeAction]
  );
}

export function useShareActionHandler(
  shareAction: ExplorerNode["shareAction"],
  onInvokeAction: (action: ExplorerAction) => void
) {
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!shareAction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInvokeAction(shareAction);
    },
    [shareAction, onInvokeAction]
  );
}
