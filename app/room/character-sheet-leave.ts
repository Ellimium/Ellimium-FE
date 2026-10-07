const LEAVE_MESSAGE = "저장하지 않은 캐릭터 시트 변경이 있습니다. 변경을 버리고 룸을 나가시겠습니까?";

// 미저장 변경이 있는 동안에만 설치하고, 저장·취소·화면 해제 시 정리한다.
export function installSheetLeaveGuard(browser: Window) {
  const current = new URL(browser.location.href);
  const leavesRoom = (url: URL) => url.origin !== current.origin || url.pathname !== current.pathname || url.search !== current.search;

  function beforeUnload(event: BeforeUnloadEvent) {
    event.preventDefault();
    event.returnValue = "";
  }

  function click(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
    const destination = new URL(link.href, current);
    // 외부 링크는 beforeunload의 브라우저 안내를 사용한다.
    if (destination.origin !== current.origin || !leavesRoom(destination)) return;
    if (!browser.confirm(LEAVE_MESSAGE)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function navigate(event: NavigateEvent) {
    // 같은 문서 내 뒤로·앞으로 이동은 beforeunload가 발생하지 않는다.
    if (event.navigationType !== "traverse" || !event.destination.sameDocument || !event.cancelable) return;
    if (leavesRoom(new URL(event.destination.url)) && !browser.confirm(LEAVE_MESSAGE)) event.preventDefault();
  }

  browser.addEventListener("beforeunload", beforeUnload);
  browser.document.addEventListener("click", click, true);
  browser.navigation?.addEventListener("navigate", navigate);
  return () => {
    browser.removeEventListener("beforeunload", beforeUnload);
    browser.document.removeEventListener("click", click, true);
    browser.navigation?.removeEventListener("navigate", navigate);
  };
}
