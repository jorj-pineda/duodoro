import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "@/test/axe";

// A small fake of the server contract: the same version checks and error codes
// as the RPCs, so UI tests exercise the real store and failure paths.
const server = vi.hoisted(() => ({
  rows: new Map<string, { session_id: string; user_id: string; reflection_text: string; created_at: string; updated_at: string; version: number }>(),
  failRead: false,
  failWrite: null as null | { code?: string; message: string },
  rpcNames: [] as string[],
  rpcArgs: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          in: async (_column2: string, ids: string[]) => {
            if (server.failRead) return { data: null, error: { message: "Unavailable" } };
            const data = [...server.rows.values()].filter(row => row.user_id === userId && ids.includes(row.session_id));
            return { data, error: null };
          },
        }),
      }),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      server.rpcNames.push(name);
      server.rpcArgs.push(args);
      if (server.failWrite) { const failure = server.failWrite; server.failWrite = null; return { data: null, error: failure }; }
      const sessionId = args.p_session_id as string;
      const current = server.rows.get(sessionId);
      const now = "2026-10-08T12:00:00Z";
      if (name === "create_session_reflection") {
        if (current) return { data: null, error: { code: "23505", message: "Reflection already exists" } };
        const row = { session_id: sessionId, user_id: "alice", reflection_text: args.p_text as string, created_at: now, updated_at: now, version: 1 };
        server.rows.set(sessionId, row);
        return { data: [row], error: null };
      }
      if (name === "update_session_reflection") {
        if (!current || current.version !== args.p_expected_version) return { data: null, error: { code: "40001", message: "Reflection changed elsewhere" } };
        current.reflection_text = args.p_text as string;
        current.version += 1;
        current.updated_at = now;
        return { data: [{ ...current }], error: null };
      }
      if (name === "delete_session_reflection") {
        if (!current || current.version !== args.p_expected_version) return { data: null, error: { code: "40001", message: "Reflection changed elsewhere" } };
        server.rows.delete(sessionId);
        return { data: [{ session_id: sessionId, user_id: "alice", deleted_version: current.version }], error: null };
      }
      return { data: null, error: { message: "unknown rpc" } };
    },
  }),
}));

import SessionReflection from "./SessionReflection";
import { useLoadSessionReflections, resetSessionReflectionStore, loadSessionReflections } from "@/hooks/useSessionReflections";

function Harness({ sessionId = "s1" }: { sessionId?: string }) {
  useLoadSessionReflections("alice", [sessionId]);
  return <SessionReflection userId="alice" sessionId={sessionId} />;
}

function seed(text: string | null, version = 1, sessionId = "s1") {
  server.rows.clear();
  if (text !== null) server.rows.set(sessionId, { session_id: sessionId, user_id: "alice", reflection_text: text, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z", version });
}

beforeEach(() => {
  seed(null);
  server.failRead = false;
  server.failWrite = null;
  server.rpcNames.length = 0;
  server.rpcArgs.length = 0;
  resetSessionReflectionStore();
});

const addButton = () => screen.findByRole("button", { name: "Add reflection" });
const textarea = () => screen.getByRole("textbox", { name: "How did this session go?" }) as HTMLTextAreaElement;

describe("editing", () => {
  it("opens an inline editor with a labeled textarea, helper text and a live count", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    const field = textarea();
    expect(field).toHaveAccessibleDescription(/Only you can see this\./);
    expect(field).toHaveAccessibleDescription(/0\/500 characters/);
    expect(screen.getByRole("button", { name: "Save reflection" })).toBeDisabled();
    await expectNoAxeViolations(document.body);
  });

  it("saves trimmed multiline text, shows confirmation, and renders the saved note as plain text", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "  First line\r\n\r\n  second line  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByText("Reflection saved")).toHaveAttribute("role", "status");
    expect(server.rpcArgs.at(-1)).toEqual({ p_session_id: "s1", p_text: "First line\n\n  second line" });
    const note = screen.getByText(/First line/);
    expect(note).toHaveClass("whitespace-pre-wrap");
    expect(note.textContent).toBe("First line\n\n  second line");
    expect(screen.getByRole("button", { name: "Edit reflection" })).toBeVisible();
  });

  it("escapes HTML-like text instead of rendering it", async () => {
    seed('<img src="x" onerror="alert(1)"><b>bold</b>');
    const { container } = render(<Harness />);
    expect(await screen.findByText(/onerror/)).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
  });

  it("explains overflow, keeps all text, and only allows saving once it is within the limit", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "x".repeat(501) } });
    expect(screen.getByRole("alert")).toHaveTextContent("1 character over the 500-character limit");
    expect(textarea().value).toHaveLength(501);
    expect(screen.getByRole("button", { name: "Save reflection" })).toBeDisabled();
    fireEvent.change(textarea(), { target: { value: "x".repeat(500) } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Save reflection" })).toBeEnabled();
  });

  it("counts emoji by code point", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "\u{1F600}".repeat(500) } });
    expect(screen.getByText("500/500 characters")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save reflection" })).toBeEnabled();
  });

  it("rejects whitespace-only text without calling the server", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "   \n  " } });
    expect(screen.getByRole("alert")).toHaveTextContent("Write a reflection before saving");
    expect(screen.getByRole("button", { name: "Save reflection" })).toBeDisabled();
    expect(server.rpcNames).toEqual([]);
  });

  it("asks before discarding a dirty draft and keeps it when the user chooses to keep editing", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "half a thought" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("group", { name: "Discard draft?" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(textarea().value).toBe("half a thought");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(server.rpcNames).toEqual([]);
  });

  it("closes a clean editor directly", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("group", { name: "Discard draft?" })).toBeNull();
  });

  it("sends one request for a double submission", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "once" } });
    const save = screen.getByRole("button", { name: "Save reflection" });
    fireEvent.click(save);
    fireEvent.click(save);
    await screen.findByText("Reflection saved");
    expect(server.rpcNames.filter(name => name === "create_session_reflection")).toHaveLength(1);
  });
});

describe("failures and conflicts", () => {
  it("does not show a failed read as an empty reflection and retries that session", async () => {
    server.failRead = true;
    render(<Harness />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load your reflection");
    expect(screen.queryByRole("button", { name: "Add reflection" })).toBeNull();
    server.failRead = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry reflection" }));
    expect(await addButton()).toBeVisible();
  });

  it("keeps the draft when a save fails and lets the user retry", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "still here" } });
    server.failWrite = { code: "08006", message: "connection lost" };
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your draft is still here");
    expect(textarea().value).toBe("still here");
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByText("Reflection saved")).toBeVisible();
  });

  it("keeps a draft on a create conflict, does not overwrite, and offers an explicit reload", async () => {
    render(<Harness />);
    fireEvent.click(await addButton());
    fireEvent.change(textarea(), { target: { value: "my draft" } });
    // Another tab saves a note after this editor opened.
    seed("saved elsewhere", 1);
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByText(/changed in another tab or device/)).toBeVisible();
    expect(textarea().value).toBe("my draft");
    fireEvent.click(await screen.findByRole("button", { name: /Reload saved reflection/ }));
    await waitFor(() => expect(textarea().value).toBe("saved elsewhere"));
    expect(server.rows.get("s1")?.reflection_text).toBe("saved elsewhere");
  });

  it("background refresh does not replace a dirty draft and a stale save is rejected", async () => {
    seed("first version", 1);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit reflection" }));
    expect(textarea().value).toBe("first version");
    fireEvent.change(textarea(), { target: { value: "my edit" } });
    // Focus return from another device updates the saved copy.
    seed("second version", 2);
    await act(async () => { await loadSessionReflections("alice", ["s1"]); });
    expect(textarea().value).toBe("my edit");
    expect(screen.getByText(/changed in another tab or device/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Save reflection" }));
    expect(await screen.findByText(/Your draft is still here/)).toBeVisible();
    expect(server.rpcArgs.at(-1)).toMatchObject({ p_expected_version: 1, p_text: "my edit" });
    expect(server.rows.get("s1")?.reflection_text).toBe("second version");
    expect(textarea().value).toBe("my edit");
    fireEvent.click(screen.getByRole("button", { name: /Reload saved reflection/ }));
    await waitFor(() => expect(textarea().value).toBe("second version"));
  });

  it("an open clean editor follows a background refresh", async () => {
    seed("one", 1);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit reflection" }));
    seed("two", 2);
    await act(async () => { await loadSessionReflections("alice", ["s1"]); });
    await waitFor(() => expect(textarea().value).toBe("two"));
    expect(screen.queryByText(/changed in another tab or device/)).toBeNull();
  });
});

describe("deletion", () => {
  it("requires a separate confirmation and can be cancelled", async () => {
    seed("to delete", 1);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete reflection" }));
    const confirm = screen.getByRole("group", { name: "Delete reflection?" });
    expect(within(confirm).getByText(/can't be undone/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep reflection" }));
    expect(server.rpcNames).toEqual([]);
    expect(screen.getByText("to delete")).toBeVisible();
  });

  it("deletes the confirmed version and reports success only after the server confirms", async () => {
    seed("to delete", 3);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete reflection" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Delete reflection?" })).getByRole("button", { name: "Delete reflection" }));
    expect(await screen.findByText("Reflection deleted")).toBeVisible();
    expect(server.rpcArgs.at(-1)).toEqual({ p_session_id: "s1", p_expected_version: 3 });
    expect(await addButton()).toBeVisible();
  });

  it("keeps the note and reports a delete failure", async () => {
    seed("keep me", 1);
    render(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Delete reflection" }));
    server.failWrite = { code: "08006", message: "lost" };
    fireEvent.click(within(screen.getByRole("group", { name: "Delete reflection?" })).getByRole("button", { name: "Delete reflection" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn't be deleted");
    // The server still holds the note; the user can retry the same confirmed delete.
    expect(server.rows.get("s1")?.reflection_text).toBe("keep me");
    fireEvent.click(within(screen.getByRole("group", { name: "Delete reflection?" })).getByRole("button", { name: "Delete reflection" }));
    expect(await screen.findByText("Reflection deleted")).toBeVisible();
  });
});

describe("accessible structure", () => {
  it("labels the section and passes an accessibility scan in view and edit states", async () => {
    seed("accessible note", 1);
    const { container } = render(<Harness />);
    expect(screen.getByText("Private reflection", { selector: "h4" })).toBeVisible();
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole("button", { name: "Edit reflection" }));
    await expectNoAxeViolations(container);
  });
});
