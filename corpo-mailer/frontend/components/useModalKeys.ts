"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]";

// Open dialogs, oldest first. Only the topmost reacts to the keyboard.
const stack: symbol[] = [];

/**
 * Keyboard behaviour shared by every modal (sheet, confirm dialog, stage picker):
 *  - Esc closes the topmost one.
 *  - Tab stays inside, and if focus has fallen out (e.g. the button you pressed disabled itself
 *    while a request ran) Tab brings it back.
 *  - Focus returns to whatever opened the modal when it closes.
 * It listens on the document, not on the panel: a focused button that becomes disabled drops
 * focus to <body>, and a handler on the panel would never hear Esc again.
 */
export function useModalKeys(box: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const id = Symbol("modal");
    stack.push(id);
    const opener = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!items.length) return e.preventDefault();
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!box.current?.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [box]);
}
