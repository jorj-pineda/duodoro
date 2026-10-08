import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import SessionTopBar from "./SessionTopBar";
vi.mock("./SoundToggle", () => ({ default: () => <button>Sound</button> }));
vi.mock("./ThemeToggle", () => ({ default: () => <button>Theme</button> }));
const props = { displayName: "Alpha", initial: "A", isPremium: false, friendsOpen: false, notesOpen: false,
  statsOpen: false, profileMenuOpen: false, onToggleFriends: vi.fn(), onToggleNotes: vi.fn(),
  onToggleStats: vi.fn(), onToggleProfileMenu: vi.fn(), onGoHome: vi.fn(), onEditAvatar: vi.fn(),
  onOpenPremium: vi.fn(), onSignOut: vi.fn() };
it("hides extras in focus, keeps open-panel controls and restores them on breaks", () => {
  const { rerender } = render(<SessionTopBar {...props} quietFocus phase="focus" notesOpen />);
  expect(screen.queryByRole("button", { name: "Toggle friends panel" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Toggle stats panel" })).toBeNull();
  expect(screen.getByRole("button", { name: "Toggle notes panel" })).toBeVisible();
  for (const name of ['Sound', 'Theme', 'Return to dashboard', 'Toggle account menu']) expect(screen.getByRole('button', { name })).toBeVisible();
  rerender(<SessionTopBar {...props} quietFocus phase="break" />);
  expect(screen.getByRole("button", { name: "Toggle friends panel" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Toggle stats panel" })).toBeVisible();
});
