export function revealMapTab(tab: HTMLButtonElement | null) {
  const list = tab?.parentElement;
  if (!tab || !list || !list.clientWidth) return;

  const left = tab.offsetLeft;
  const right = left + tab.offsetWidth;
  if (left < list.scrollLeft || tab.offsetWidth > list.clientWidth) list.scrollLeft = left;
  else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth;
}
