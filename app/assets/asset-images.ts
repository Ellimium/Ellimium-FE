export type Asset = {
  id: string;
  category: "map" | "token" | "item" | "other";
  storage_path: string;
  thumbnail_storage_path: string | null;
  created_at: string;
};

export function assetImagePaths(assets: Asset[]) {
  return [...new Set(assets.flatMap(({ category, storage_path, thumbnail_storage_path }) => [
    thumbnail_storage_path,
    category === "map" || !thumbnail_storage_path ? storage_path : null,
  ]).filter((path): path is string => Boolean(path)))];
}

export function shortIds(values: string[]) {
  const ids = [...new Set(values)];
  return new Map(ids.map((id) => {
    let length = 8;
    while (length < id.length && ids.some((other) => other !== id && other.startsWith(id.slice(0, length)))) length++;
    return [id, id.slice(0, length)];
  }));
}

export function assetLabels(assets: Pick<Asset, "id" | "category">[]) {
  const ids = shortIds(assets.map((asset) => asset.id));
  const categories = { map: "맵", token: "토큰", item: "아이템", other: "기타" };
  return new Map(assets.map(({ id, category }) => [id, `${categories[category]} · ${ids.get(id)}`]));
}
