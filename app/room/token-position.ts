export function mapPointFromClient(
  clientX: number,
  clientY: number,
  viewport: { left: number; top: number; width: number; height: number },
  map: { width: number; height: number },
) {
  const scale = Math.min(viewport.width / map.width, viewport.height / map.height);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  return {
    x: (clientX - viewport.left - (viewport.width - map.width * scale) / 2) / scale,
    y: (clientY - viewport.top - (viewport.height - map.height * scale) / 2) / scale,
  };
}

export function gridCoordinate(pixel: number, offset: number, cellSize: number) {
  return Math.round(((pixel - offset) / cellSize) * 100) / 100;
}
