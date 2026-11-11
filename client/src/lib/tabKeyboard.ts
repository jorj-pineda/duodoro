import type { KeyboardEvent } from "react";

/** WAI-ARIA tab-list keyboard behavior for horizontal tab sets. */
export function handleTabKeyNavigation<T extends string>(
  event: KeyboardEvent<HTMLButtonElement>,
  tabs: readonly T[],
  current: T,
  onSelect: (tab: T) => void | boolean,
  idFor: (tab: T) => string,
) {
  let nextIndex: number | null = null;
  const currentIndex = tabs.indexOf(current);
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowLeft") {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  }
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  const next = tabs[nextIndex];
  if (onSelect(next) === false) return;
  document.getElementById(idFor(next))?.focus();
}
