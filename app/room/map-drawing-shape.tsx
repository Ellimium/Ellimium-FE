import type { PointerEvent } from "react";

import type { DrawingDraft, MapDrawing } from "./map-drawing";

type Props = {
  drawing: DrawingDraft | MapDrawing;
  selected?: boolean;
  editable?: boolean;
  onSelect?: (event: PointerEvent<SVGElement>) => void;
};

export default function MapDrawingShape({ drawing, selected = false, editable = false, onSelect }: Props) {
  const common = {
    className: `map-drawing${selected ? " drawing-selected" : ""}`,
    stroke: drawing.color,
    strokeWidth: drawing.stroke_width,
    vectorEffect: "non-scaling-stroke" as const,
    pointerEvents: editable ? "visiblePainted" as const : "none" as const,
    onPointerDown: onSelect,
  };

  if (drawing.drawing_type === "line") {
    return <line {...common} x1={drawing.geometry.start.x} y1={drawing.geometry.start.y} x2={drawing.geometry.end.x} y2={drawing.geometry.end.y} />;
  }

  if (drawing.drawing_type === "circle") {
    return <circle {...common} cx={drawing.geometry.center.x} cy={drawing.geometry.center.y} r={drawing.geometry.radius} />;
  }

  if (drawing.drawing_type === "rectangle") {
    return <rect {...common} x={drawing.geometry.x} y={drawing.geometry.y} width={drawing.geometry.width} height={drawing.geometry.height} />;
  }

  if (drawing.drawing_type === "freehand") {
    const path = drawing.geometry.points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
    return <path {...common} d={path} />;
  }

  return <text
    {...common}
    x={drawing.geometry.x}
    y={drawing.geometry.y}
    fill={drawing.color}
    stroke="none"
    fontSize={Math.max(14, drawing.stroke_width * 5)}
    paintOrder="stroke"
  >{drawing.text_content}</text>;
}
