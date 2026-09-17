import type { FreeShapeAnnotation } from "../core/types/topology";

import { DEFAULT_LINE_LENGTH } from "./constants";

interface Point {
  x: number;
  y: number;
}

/** Clockwise canvas degrees, in [-180, 180). Keep precision until display. */
export function normalizeRotation(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  const normalized = ((((angle + 180) % 360) + 360) % 360) - 180;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function angleBetweenPoints(start: Point, end: Point): number | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.000001) return null;
  return normalizeRotation((Math.atan2(dy, dx) * 180) / Math.PI);
}

/** Parallel text should read left-to-right, regardless of link direction. */
export function uprightRotation(angle: number): number {
  const normalized = normalizeRotation(angle);
  if (normalized > 90) return normalized - 180;
  if (normalized < -90) return normalized + 180;
  return normalized;
}

export function formatRotation(angle: number): string {
  return String(Number(normalizeRotation(angle).toFixed(2)));
}

export function getShapeRotation(shape: FreeShapeAnnotation): number {
  if (shape.shapeType !== "line") return normalizeRotation(shape.rotation ?? 0);
  return (
    angleBetweenPoints(
      shape.position,
      shape.endPosition ?? {
        x: shape.position.x + DEFAULT_LINE_LENGTH,
        y: shape.position.y
      }
    ) ?? 0
  );
}

/** Rotate the actual endpoints, keeping the line's center, length and arrow direction. */
export function rotateLine(
  shape: FreeShapeAnnotation,
  angle: number
): Partial<FreeShapeAnnotation> {
  const start = shape.position;
  const end = shape.endPosition ?? {
    x: start.x + DEFAULT_LINE_LENGTH,
    y: start.y
  };
  const radius = Math.hypot(end.x - start.x, end.y - start.y) / 2;
  const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const radians = (normalizeRotation(angle) * Math.PI) / 180;
  const dx = radius * Math.cos(radians);
  const dy = radius * Math.sin(radians);
  return {
    position: { x: center.x - dx, y: center.y - dy },
    endPosition: { x: center.x + dx, y: center.y + dy },
    rotation: normalizeRotation(angle)
  };
}

/** Use the rendered path so curved, parallel and loop links match what users see. */
export function getPathRotation(path: SVGPathElement): number | null {
  const length = path.getTotalLength();
  if (!Number.isFinite(length) || length < 0.000001) return null;
  const midpoint = length / 2;
  const sample = Math.min(1, length / 4);
  return angleBetweenPoints(
    path.getPointAtLength(midpoint - sample),
    path.getPointAtLength(midpoint + sample)
  );
}
