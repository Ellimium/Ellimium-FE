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
    category === "map" ? storage_path : null,
  ]).filter((path): path is string => Boolean(path)))];
}
