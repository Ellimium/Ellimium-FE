export type AssetFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
};

export function orderedFolders(folders: AssetFolder[], parentId: string | null = null): AssetFolder[] {
  return folders.filter((folder) => folder.parent_id === parentId)
    .flatMap((folder) => [folder, ...orderedFolders(folders, folder.id)]);
}

export function folderError(action: "create" | "rename" | "delete", code?: string) {
  if (code === "23503" && action === "delete") {
    return "하위 폴더나 자산이 있는 폴더는 삭제할 수 없습니다. 먼저 자산을 옮기고 하위 폴더를 정리하세요.";
  }
  if (code === "42501" || code === "PGRST116") {
    return "폴더를 변경할 권한이 없거나 폴더가 없어졌습니다. 목록을 새로고침하고 로그인 상태를 확인하세요.";
  }
  return "폴더 작업을 완료할 수 없습니다. 목록을 새로고침한 뒤 다시 시도하세요.";
}
