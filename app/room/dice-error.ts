type DiceError = { code?: string | null; message?: string | null };

export function diceErrorMessage(error: DiceError) {
  const message = error.message ?? "";

  if (error.code === "42501" || message.includes("permission") || message.includes("authentication")) return "주사위 굴림 권한이 없습니다.";
  if (message.includes("invalid dice expression")) return "주사위 표현식을 확인하세요. 예: /roll 2d6+3";
  if (message.includes("dice count")) return "주사위 개수는 1개에서 100개 사이여야 합니다.";
  if (message.includes("dice sides") || message.includes("keep count") || message.includes("modifier") || message.includes("dice total")) return "지원하는 주사위 숫자 범위를 벗어났습니다.";
  return "주사위 요청을 처리하지 못했습니다.";
}
