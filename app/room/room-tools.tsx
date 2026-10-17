"use client";

type Props = {
  canDraw: boolean;
  canManageMap: boolean;
  drawingEditing: boolean;
  fogEditing: boolean;
  onDrawing: () => void;
  onFog: () => void;
};

export default function RoomTools({ canDraw, canManageMap, drawingEditing, fogEditing, onDrawing, onFog }: Props) {
  return <aside className="tool-rail" aria-label="맵 도구">
    <button className={drawingEditing ? "tool-active" : ""} type="button" aria-label="그리기" aria-expanded={drawingEditing} aria-controls="map-drawing-controls" disabled={!canDraw} onClick={onDrawing}>✎</button>
    <button className={fogEditing ? "tool-active" : ""} type="button" aria-label="시야 설정" aria-expanded={fogEditing} aria-controls="map-fog-controls" disabled={!canManageMap} onClick={onFog}>◐</button>
  </aside>;
}
