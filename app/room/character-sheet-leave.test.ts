import assert from "node:assert/strict";
import test from "node:test";
import { installSheetLeaveGuard } from "./character-sheet-leave.ts";

test("룸 이탈 취소·확인, 새 탭·동일 룸 이동 예외와 저장·취소 후 가드 해제를 처리한다", () => {
  let href = "https://ellimium.test/";
  let target = "";
  let download = false;
  let allow = false;
  let confirmations = 0;
  const document = Object.assign(new EventTarget(), {
    closest: () => ({ href, target, hasAttribute: () => download }),
  });
  const navigation = new EventTarget();
  const browser = Object.assign(new EventTarget(), {
    location: { href: "https://ellimium.test/room?roomId=a" },
    document, navigation,
    confirm: () => { confirmations++; return allow; },
  });
  const cleanup = installSheetLeaveGuard(browser as unknown as Window);
  const click = (options = {}) => {
    const event = Object.assign(new Event("click", { cancelable: true }), { button: 0, ...options });
    document.dispatchEvent(event);
    return event.defaultPrevented;
  };

  assert.equal(click(), true);
  allow = true;
  assert.equal(click(), false);
  assert.equal(confirmations, 2);
  allow = false;
  assert.equal(click({ ctrlKey: true }), false);
  target = "_blank";
  assert.equal(click(), false);
  target = ""; download = true;
  assert.equal(click(), false);
  download = false; href = "https://ellimium.test/room?roomId=a#sheets";
  assert.equal(click(), false);
  href = "https://ellimium.test/room?roomId=b";
  assert.equal(click(), true);

  const traverse = (url: string, sameDocument = true) => {
    const event = Object.assign(new Event("navigate", { cancelable: true }), { navigationType: "traverse", destination: { url, sameDocument } });
    navigation.dispatchEvent(event);
    return event.defaultPrevented;
  };
  assert.equal(traverse("https://ellimium.test/"), true);
  allow = true;
  assert.equal(traverse("https://ellimium.test/"), false);
  allow = false;
  assert.equal(traverse("https://ellimium.test/room?roomId=a#sheets"), false);
  assert.equal(traverse("https://ellimium.test/", false), false);
  const unload = new Event("beforeunload", { cancelable: true });
  browser.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);

  cleanup();
  href = "https://ellimium.test/";
  assert.equal(click(), false);
  assert.equal(traverse("https://ellimium.test/"), false);
  const savedUnload = new Event("beforeunload", { cancelable: true });
  browser.dispatchEvent(savedUnload);
  assert.equal(savedUnload.defaultPrevented, false);
});
