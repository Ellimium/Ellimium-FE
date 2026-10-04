import { mapPointFromClient } from "./token-position.ts";

export const DRAWING_TYPES = ["line", "circle", "rectangle", "freehand", "text"] as const;

export type DrawingType = typeof DRAWING_TYPES[number];
export type DrawingPoint = { x: number; y: number };
export type DrawingStyle = { color: string; strokeWidth: number };

type DrawingBase<Type extends DrawingType, Geometry> = {
  drawing_type: Type;
  geometry: Geometry;
  text_content: string | null;
  color: string;
  stroke_width: number;
};

export type LineDrawing = DrawingBase<"line", { start: DrawingPoint; end: DrawingPoint }>;
export type CircleDrawing = DrawingBase<"circle", { center: DrawingPoint; radius: number }>;
export type RectangleDrawing = DrawingBase<"rectangle", { x: number; y: number; width: number; height: number }>;
export type FreehandDrawing = DrawingBase<"freehand", { points: DrawingPoint[] }>;
export type TextDrawing = DrawingBase<"text", { x: number; y: number }> & { text_content: string };

export type DrawingDraft = LineDrawing | CircleDrawing | RectangleDrawing | FreehandDrawing | TextDrawing;
export type MapDrawing = DrawingDraft & {
  id: string;
  map_id: string;
  created_at: string;
  updated_at: string;
};

export function canEditMapDrawing(
  canViewMap: boolean,
  canUseDrawing: boolean,
  role: "master" | "player" | "spectator" | null,
) {
  return canViewMap && canUseDrawing && (role === "master" || role === "player");
}

function validPoint(point: DrawingPoint | undefined): point is DrawingPoint {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
}

function validStyle(style: DrawingStyle) {
  return /^#[0-9A-Fa-f]{6}$/.test(style.color)
    && Number.isFinite(style.strokeWidth)
    && style.strokeWidth > 0
    && style.strokeWidth <= 100;
}

function base<Type extends DrawingType>(drawingType: Type, style: DrawingStyle) {
  return {
    drawing_type: drawingType,
    text_content: null,
    color: style.color,
    stroke_width: style.strokeWidth,
  };
}

export function createDrawingDraft(
  drawingType: DrawingType,
  points: DrawingPoint[],
  style: DrawingStyle,
  textContent?: string,
): DrawingDraft | null {
  if (!validStyle(style) || points.some((point) => !validPoint(point))) return null;

  const start = points[0];
  const end = points.at(-1);
  if (!validPoint(start)) return null;

  if (drawingType === "text") {
    const content = textContent?.trim();
    if (!content || content.length > 500) return null;
    return {
      ...base(drawingType, style),
      geometry: { x: start.x, y: start.y },
      text_content: content,
    };
  }

  if (!validPoint(end)) return null;
  if (drawingType === "freehand") {
    if (points.length < 2) return null;
    return { ...base(drawingType, style), geometry: { points: [...points] } };
  }

  if (drawingType === "line") {
    if (start.x === end.x && start.y === end.y) return null;
    return { ...base(drawingType, style), geometry: { start, end } };
  }

  if (drawingType === "circle") {
    const radius = Math.hypot(end.x - start.x, end.y - start.y);
    if (radius < 1) return null;
    return { ...base(drawingType, style), geometry: { center: start, radius } };
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (width < 1 || height < 1) return null;
  return { ...base(drawingType, style), geometry: { x, y, width, height } };
}

export function drawingPointFromClient(
  clientX: number,
  clientY: number,
  viewport: { left: number; top: number; width: number; height: number },
  map: { width: number; height: number },
) {
  const point = mapPointFromClient(clientX, clientY, viewport, map);
  if (!point || point.x < 0 || point.y < 0 || point.x > map.width || point.y > map.height) return null;
  return point;
}
