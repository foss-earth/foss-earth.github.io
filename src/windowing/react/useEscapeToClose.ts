import { useEffect } from "react";

/**
 * While a menu is open, Escape closes it and does nothing else: the window
 * sees the key first, so no panorama is left and no binding reads it. Focus
 * goes back to `returnFocus`, the button that opened the menu, so a menu
 * item that had it does not drop focus to the page as the menu goes.
 */
export function useEscapeToClose(open: boolean, close: () => void, returnFocus?: () => HTMLElement | null): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      close();
      returnFocus?.()?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, close, returnFocus]);
}
