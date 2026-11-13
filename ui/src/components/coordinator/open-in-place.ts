import type { MouseEvent } from "react";

/**
 * Click handler for a link that normally opens in place through `onOpen`.
 * A modified click (ctrl, cmd, shift, alt, or a non-primary button) is left to
 * the browser, so the link can open in a new tab or window.
 */
export function openInPlace(event: MouseEvent<HTMLAnchorElement>, href: string, onOpen: (href: string) => void) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  onOpen(href);
}
