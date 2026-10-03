export type VisibilityArea = { x: number; y: number; width: number; height: number };

export function rectangleFromPoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  map: { width: number; height: number },
) {
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(map.width, Math.max(start.x, end.x));
  const bottom = Math.min(map.height, Math.max(start.y, end.y));
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function hideArea(areas: VisibilityArea[], hidden: VisibilityArea) {
  return areas.flatMap((area) => {
    const left = Math.max(area.x, hidden.x);
    const top = Math.max(area.y, hidden.y);
    const right = Math.min(area.x + area.width, hidden.x + hidden.width);
    const bottom = Math.min(area.y + area.height, hidden.y + hidden.height);
    if (left >= right || top >= bottom) return [area];

    return [
      { x: area.x, y: area.y, width: area.width, height: top - area.y },
      { x: area.x, y: bottom, width: area.width, height: area.y + area.height - bottom },
      { x: area.x, y: top, width: left - area.x, height: bottom - top },
      { x: right, y: top, width: area.x + area.width - right, height: bottom - top },
    ].filter((part) => part.width > 0 && part.height > 0);
  });
}
