export type AssetCategory = "map" | "token" | "item" | "other";

type UploadFile = Pick<File, "size" | "type">;

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function validateUpload(category: string, file: UploadFile, thumbnail?: UploadFile) {
  if (!(["map", "token", "item", "other"] as string[]).includes(category)) {
    return "카테고리를 선택하세요.";
  }
  if (!allowedTypes.has(file.type)) {
    return "JPEG, PNG, WebP, GIF 이미지만 업로드할 수 있습니다.";
  }

  const maxBytes = category === "map" ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    return `${category === "map" ? "맵" : "이미지"} 파일은 ${maxBytes / 1024 / 1024}MB 이하여야 합니다.`;
  }
  if (thumbnail && !allowedTypes.has(thumbnail.type)) {
    return "썸네일은 JPEG, PNG, WebP, GIF 이미지만 사용할 수 있습니다.";
  }
  if (thumbnail && thumbnail.size > 5 * 1024 * 1024) {
    return "썸네일은 5MB 이하여야 합니다.";
  }
  return "";
}
