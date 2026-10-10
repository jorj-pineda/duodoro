"use client";
import { useEffect } from "react";

type Actions = { start?: () => void; stats?: () => void; quiet?: () => void; help?: () => void };

export function useKeyboardShortcuts(enabled: boolean, blocked: boolean, actions: Actions) {
  useEffect(() => {
    if (!enabled || blocked) return;
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.keyCode === 229 ||
          event.ctrlKey || event.metaKey || event.altKey || document.visibilityState === "hidden") return;
      if (event.shiftKey && event.key !== "?") return;
      // Check the composed path too, so nested and shadow-root editors retain their keys.
      if (event.composedPath().some(target => target instanceof HTMLElement &&
          (target.matches("input, textarea, select") || target.isContentEditable ||
           target.closest('[contenteditable]:not([contenteditable="false"]), [role="textbox"]')))) return;
      if (document.querySelector('[role="dialog"], [role="menu"], dialog[open], [aria-haspopup][aria-expanded="true"]')) return;
      const action = ({ s: actions.start, t: actions.stats, q: actions.quiet, "?": actions.help } as Record<string, (() => void) | undefined>)[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled, blocked, actions]);
}
