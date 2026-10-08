import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import HomeDashboard from "./HomeDashboard";
import { WORLDS } from "@/lib/avatarData";
import { worldAt } from "@/lib/rotation";
import type { Profile } from "@/lib/types";
import { expectNoAxeViolations } from "@/test/axe";

// Home used to open with an eight-thumbnail world picker and hand the choice
// to onFocus. With the rotation the choice doesn't exist: there is one world,
// the server picks it, and pressing Focus takes whatever is up.

vi.mock("@/hooks/useSharedMilestones", () => ({ useSharedMilestones: () => ({ rows: [], loaded: true, error: null, retry: vi.fn() }) }));

vi.mock("@/hooks/useWeeklyDuoRecap", () => ({ useWeeklyDuoRecap: () => ({ rows: [], loaded: true, error: null, timezone: "UTC", retry: vi.fn() }) }));

vi.mock("@/lib/useStats", () => ({
  useStats: () => ({
    personalStats: null,
    duoStats: null,
    recentSessions: [],
    dailyFocus: [],
    loading: false,
    error: null,
    loaded: true,
    retry: vi.fn(),
    fetchStats: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSharedDailyGoals", () => ({
  useSharedDailyGoals: () => ({ goals: [], loadError: null, actionError: null, busy: false }),
}));

vi.mock("@/hooks/useTasks", () => ({
  useTasks: () => ({
    tasks: [],
    newTask: "",
    setNewTask: vi.fn(),
    addTask: vi.fn(),
    toggleTask: vi.fn(),
    deleteTask: vi.fn(),
    editTask: vi.fn().mockResolvedValue(null),
    pendingTasks: [],
    completedTasks: [],
    clearCompleted: vi.fn(),
    error: null,
    clearError: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineFriends", () => ({
  useOnlineFriends: () => ({
    friends: [],
    loaded: true,
    onlineFriendIds: [],
    error: null,
    retry: vi.fn(),
  }),
}));

const profile: Profile = {
  id: "user-1",
  username: "jorge",
  discriminator: "0001",
  username_changed: false,
  display_name: "Jorge",
  display_name_changed_at: null,
  avatar_config: null,
  is_premium: false,
  current_room: null,
  current_session_id: null,
  current_world_id: null,
  updated_at: "2026-08-12T00:00:00Z",
};

function homeProps(
  overrides: Partial<Parameters<typeof HomeDashboard>[0]> = {},
): Parameters<typeof HomeDashboard>[0] {
  const onFocus = overrides.onFocus ?? vi.fn();
  const onOpenPremium = overrides.onOpenPremium ?? vi.fn();
  return {
    profile: overrides.profile ?? profile,
    socketRef: overrides.socketRef ?? { current: null },
    onFocus,
    onOpenPremium,
    onRejoinSession: overrides.onRejoinSession ?? vi.fn(),
    onJoinSession: overrides.onJoinSession ?? vi.fn(),
    onInvite: overrides.onInvite ?? vi.fn(),
    onEditAvatar: overrides.onEditAvatar ?? vi.fn(),
    onChangeUsername: overrides.onChangeUsername ?? vi.fn(),
    onChangeDisplayName: overrides.onChangeDisplayName ?? vi.fn(),
    onSignOut: overrides.onSignOut ?? vi.fn(),
    onAccountDeleted: overrides.onAccountDeleted ?? vi.fn(),
    onOpenFriends: overrides.onOpenFriends ?? vi.fn(),
    onOpenStats: overrides.onOpenStats ?? vi.fn(),
  };
}

function renderHome(overrides: Partial<Parameters<typeof HomeDashboard>[0]> = {}) {
  const props = homeProps(overrides);
  const utils = render(<HomeDashboard {...props} />);
  return {
    ...utils,
    onFocus: props.onFocus,
    onOpenPremium: props.onOpenPremium,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(Date.parse("2026-08-12T09:07:30Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HomeDashboard greeting", () => {
  it("keeps the server-rendered greeting independent of the server clock", () => {
    vi.setSystemTime(Date.parse("2026-08-12T23:00:00Z"));
    const markup = renderToStaticMarkup(
      <HomeDashboard {...homeProps()} />,
    );

    expect(markup).toContain("Hello, Jorge");
    expect(markup).not.toMatch(/Good (morning|afternoon|evening)/);
  });

  it("uses the browser-local greeting after mount", () => {
    vi.setSystemTime(new Date(2026, 7, 12, 14, 0, 0));
    renderHome();

    expect(
      screen.getByRole("heading", { name: "Good afternoon, Jorge" }),
    ).toBeInTheDocument();
  });
});

describe("HomeDashboard world rotation", () => {
  it("has no detectable semantic accessibility violations", async () => {
    const { container } = renderHome();
    await expectNoAxeViolations(container);
  });

  it("offers no world to choose", () => {
    renderHome();
    expect(screen.queryByText("Choose a world")).not.toBeInTheDocument();
    // Every world but the current one should be absent. Naming them
    // individually rather than counting buttons, so this still fails if the
    // picker comes back in a different shape.
    const current = worldAt(Date.now());
    for (const world of WORLDS) {
      if (world.id === current) continue;
      expect(screen.queryByText(world.label)).not.toBeInTheDocument();
    }
  });

  it("shows the world the rotation is on", () => {
    renderHome();
    const current = WORLDS.find((w) => w.id === worldAt(Date.now()))!;
    expect(screen.getByText("Everyone's world")).toBeInTheDocument();
    expect(screen.getByText(current.label)).toBeInTheDocument();
    expect(screen.getByText("22:30")).toBeInTheDocument();
  });

  it("starts a session without being told where", () => {
    const { onFocus } = renderHome();
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(onFocus).toHaveBeenCalledTimes(1);
    // Previously this was onFocus(selectedWorld). Nothing may be passed now —
    // an argument here would mean the client still believes it decides.
    expect(onFocus).toHaveBeenCalledWith();
  });
});

describe("HomeDashboard premium entry point", () => {
  /** Open the avatar menu, where the upgrade button lives. */
  function openProfileMenu() {
    fireEvent.click(screen.getByRole("button", { name: "Open account menu" }));
  }

  it("closes the account menu with Escape and restores trigger focus", () => {
    renderHome();
    const trigger = screen.getByRole("button", { name: "Open account menu" });
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Account menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByLabelText("Account menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("opens the premium modal from the home screen", () => {
    // The bug: this button's entire onClick was setProfileMenuOpen(false).
    // It closed the menu and did nothing else, so the home screen — the
    // primary place anyone would look — silently dropped the request, while
    // the in-session button next to it worked.
    const { onOpenPremium } = renderHome();
    openProfileMenu();
    fireEvent.click(screen.getByRole("button", { name: /Unlock companions/ }));
    expect(onOpenPremium).toHaveBeenCalledTimes(1);
  });

  it("closes the menu on the way", () => {
    // Guard: the one thing the old handler did right.
    renderHome();
    openProfileMenu();
    expect(screen.getByText("Change display name")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unlock companions/ }));
    expect(screen.queryByText("Change display name")).not.toBeInTheDocument();
  });

  it("does not offer the unlock to someone who already has it", () => {
    renderHome({ profile: { ...profile, is_premium: true } });
    openProfileMenu();
    expect(screen.queryByText(/Unlock companions/)).not.toBeInTheDocument();
  });
});
