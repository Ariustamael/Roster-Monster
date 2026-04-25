import { useEffect } from "react";

/**
 * Close the topmost modal when the user presses Escape.
 * Each mounted modal registers its own close handler; the stack-based listener
 * ensures only the top one (most-recently mounted) fires on a single ESC press.
 */
const closeStack: Array<() => void> = [];
let listenerAttached = false;

function handleKey(e: KeyboardEvent) {
  if (e.key !== "Escape") return;
  const top = closeStack[closeStack.length - 1];
  if (top) {
    e.stopPropagation();
    top();
  }
}

export function useEscClose(onClose: () => void, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    closeStack.push(onClose);
    if (!listenerAttached) {
      window.addEventListener("keydown", handleKey);
      listenerAttached = true;
    }
    return () => {
      const idx = closeStack.indexOf(onClose);
      if (idx !== -1) closeStack.splice(idx, 1);
      if (closeStack.length === 0 && listenerAttached) {
        window.removeEventListener("keydown", handleKey);
        listenerAttached = false;
      }
    };
  }, [onClose, enabled]);
}
