// Dragging a line card by its grip onto another card slot.
import type React from "react";
import { useState } from "react";

import type { ChassisSlot } from "../../../../core/sros/srsimChassis";

/** Only this tab reads it, so a card dropped on a text field or the canvas does nothing there */
const CARD_DRAG_TYPE = "application/x-clab-chassis-card";

/** How far into the drag image the pointer sits, so the row hangs off the grip */
const DRAG_IMAGE_OFFSET = 12;

export type SlotDragState = "dragged" | "target";

export type GripProps = Pick<React.HTMLAttributes<HTMLElement>, "draggable" | "onDragStart" | "onDragEnd">;

export type DropProps = Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDragLeave" | "onDrop">;

export interface CardDrag {
  gripProps: (slot: ChassisSlot) => GripProps;
  dropProps: (slot: ChassisSlot) => DropProps;
  stateOf: (slot: ChassisSlot) => SlotDragState | undefined;
}

export function useCardDrag(onMove: (slot: ChassisSlot, name: string) => void): CardDrag {
  const [dragged, setDragged] = useState<ChassisSlot>();
  const [targetId, setTargetId] = useState<string>();

  const stop = (): void => {
    setDragged(undefined);
    setTargetId(undefined);
  };

  return {
    gripProps: (slot) => ({
      draggable: true,
      onDragStart: (event) => {
        const { dataTransfer, currentTarget } = event;
        dataTransfer.effectAllowed = "move";
        dataTransfer.setData(CARD_DRAG_TYPE, slot.id);
        // The row's controls, without the MDAs and XIOMs open below them
        const row = currentTarget.parentElement;
        if (row) dataTransfer.setDragImage(row, DRAG_IMAGE_OFFSET, row.offsetHeight / 2);
        setDragged(slot);
      },
      onDragEnd: stop
    }),
    dropProps: (slot) => {
      if (dragged === undefined || slot.role !== "card" || slot.id === dragged.id) return {};
      return {
        onDragOver: (event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setTargetId(slot.id);
        },
        onDragLeave: (event) => {
          const { relatedTarget, currentTarget } = event;
          if (relatedTarget instanceof Node && currentTarget.contains(relatedTarget)) return;
          setTargetId((current) => (current === slot.id ? undefined : current));
        },
        onDrop: (event) => {
          event.preventDefault();
          onMove(dragged, slot.label);
          stop();
        }
      };
    },
    stateOf: (slot) => {
      if (slot.id === dragged?.id) return "dragged";
      return slot.id === targetId ? "target" : undefined;
    }
  };
}
