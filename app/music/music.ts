export type MusicAsset = {
  id: string;
  title: string;
  mime_type: string;
  file_size_bytes: number;
  duration_ms: number;
  deletion_pending: boolean;
};

const formats: Record<string, string> = { mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav" };

export function musicUploadBody(title: string, file: File) {
  if (!title.trim()) throw new Error("음악 제목을 입력하세요.");
  if (!file.size) throw new Error("비어 있지 않은 음악 파일을 선택하세요.");
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const mime = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  if (!mime) throw new Error("MP3, OGG, WAV 파일만 업로드할 수 있습니다.");
  const declared = file.type.toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== mime &&
      !(extension === "wav" && declared === "audio/x-wav") &&
      !(extension === "ogg" && declared === "application/ogg")) {
    throw new Error("파일 확장자와 음악 형식이 일치하지 않습니다.");
  }
  const body = new FormData();
  body.set("title", title.trim());
  body.set("file", new Blob([file], { type: mime }), file.name);
  return body;
}

export function musicUploadError(status: number, body: { code?: string; error?: string } | null) {
  if (status === 401) return "로그인이 만료되었습니다. 다시 로그인하세요.";
  if (body?.code === "cleanup_failed") return "업로드와 실패 정리를 완료하지 못했습니다. 관리자에게 문의하세요.";
  if (status === 413 || body?.code === "storage_size_limit") return "Storage에서 파일 용량을 허용하지 않습니다. 더 작은 파일로 시도하세요.";
  if (body?.code === "invalid_music_file" || status === 400) {
    if (body?.error?.includes("decoded")) return "음악을 디코딩하거나 재생 시간을 확인할 수 없습니다. 파일 손상과 코덱을 확인하세요.";
    return "MP3, OGG, WAV 형식과 파일 내용을 확인하세요.";
  }
  if (body?.code === "metadata_save_failed") return "음악 정보를 저장하지 못했습니다. 잠시 후 다시 시도하세요.";
  if (body?.code === "storage_upload_failed") return "Storage에서 업로드를 거부했습니다. 잠시 후 다시 시도하세요.";
  return "음악을 업로드하지 못했습니다. 잠시 후 다시 시도하세요.";
}

export function musicDuration(durationMs: number) {
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function musicSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function musicFormat(mime: string) {
  return mime === "audio/mpeg" ? "MP3" : mime === "audio/ogg" ? "OGG" : "WAV";
}

export function musicMutationError(action: "rename" | "delete", code?: string, status?: number) {
  if (status === 401) return "로그인이 만료되었습니다. 다시 로그인하세요.";
  if (code === "42501" || status === 403) return "이 음악을 변경할 권한이 없습니다.";
  if (code === "P0002") return "이미 삭제된 음악입니다. 목록을 확인하세요.";
  if (code === "23514") return "삭제 처리 중인 음악의 제목은 변경할 수 없습니다.";
  if (code === "22023" || status === 400) return "음악 제목과 요청 내용을 확인하세요.";
  return action === "delete"
    ? "삭제를 완료하지 못했습니다. 같은 음악의 삭제를 다시 시도하세요."
    : "제목을 변경하지 못했습니다. 잠시 후 다시 시도하세요.";
}
