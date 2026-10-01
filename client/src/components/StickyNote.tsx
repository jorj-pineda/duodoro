"use client";
import { useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useModalAccessibility } from "@/hooks/useModalAccessibility";
import { handleTabKeyNavigation } from "@/lib/tabKeyboard";
import { useStickyNotes } from "@/hooks/useStickyNotes";
import type { Task } from "@/lib/types";
import { CloseIcon, PencilIcon } from "./Icons";

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  roomCode: string | null;
  /** The other player in the session, for attributing shared goals. Both come
   *  straight from the sync payload, so no extra lookup is needed. */
  partnerUserId?: string | null;
  partnerName?: string;
}

const NOTE_COLORS = [
  {
    label: "Yellow",
    gradient: "linear-gradient(180deg, #fef9c3 0%, #fef08a 100%)",
    accent: "#78350f",
  },
  {
    label: "Pink",
    gradient: "linear-gradient(180deg, #fce7f3 0%, #fbcfe8 100%)",
    accent: "#831843",
  },
  {
    label: "Blue",
    gradient: "linear-gradient(180deg, #dbeafe 0%, #bfdbfe 100%)",
    accent: "#1e3a5f",
  },
  {
    label: "Green",
    gradient: "linear-gradient(180deg, #d1fae5 0%, #a7f3d0 100%)",
    accent: "#064e3b",
  },
];
const TASK_TABS = ["mine", "shared"] as const;

export function TaskRow({
  task,
  isOwn,
  nameFor,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task;
  /** Editing and deletion are owner-only; either partner can toggle completion. */
  isOwn: boolean;
  nameFor: (userId: string) => string;
  onToggle: (id: string, done: boolean) => void;
  onEdit: (id: string, content: string) => Promise<string | null>;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.content);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const finishEditing = () => {
    setEditing(false);
    window.requestAnimationFrame(() => editButton.current?.focus());
  };
  const save = async () => {
    const text = draft.trim();
    if (savingRef.current || !text || text.length > 500) return;
    if (text === task.content) {
      finishEditing();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setEditError(null);
    try {
      const error = await onEdit(task.id, text);
      if (error) setEditError(error);
      else finishEditing();
    } catch {
      setEditError("Couldn't save your changes. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const credit = task.completed_by ? nameFor(task.completed_by) : null;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="flex items-start gap-2 group py-1.5"
    >
      <button
        onClick={() => onToggle(task.id, !task.is_done)}
        disabled={saving}
        aria-label={task.is_done ? "Mark as not done" : "Mark as done"}
        className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
          task.is_done
            ? "bg-emerald-600 border-emerald-600"
            : "border-amber-600 hover:border-emerald-600"
        }`}
      >
        {task.is_done && <span className="text-white text-xs">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        {editing && isOwn ? (
          <div
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                event.preventDefault();
                if (!savingRef.current) finishEditing();
              }
            }}
          >
            <textarea
              autoFocus
              aria-label="Edit note text"
              rows={2}
              maxLength={500}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void save();
                }
              }}
              className="w-full rounded border border-amber-600 bg-white/60 p-1.5 text-sm font-mono text-amber-900 focus:outline-amber-700 resize-y disabled:opacity-60"
            />
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => void save()}
                disabled={saving || !draft.trim() || draft.trim().length > 500}
                className="min-h-11 sm:min-h-9 px-2 text-xs font-mono font-bold text-amber-900 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={finishEditing}
                disabled={saving}
                className="min-h-11 sm:min-h-9 px-2 text-xs font-mono text-amber-900 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {editError && (
              <p role="alert" className="text-xs text-red-700 mt-1">{editError}</p>
            )}
          </div>
        ) : (
          <p
            className={`text-sm leading-snug font-mono break-words whitespace-pre-wrap transition-colors ${
              task.is_done ? "line-through text-amber-500" : "text-amber-900"
            }`}
          >
            {task.content}
          </p>
        )}
        {credit && (
          <p className="text-[10px] font-mono text-amber-600/80 mt-0.5">
            ✓ by {credit}
          </p>
        )}
        {!isOwn && !credit && (
          <p className="text-[10px] font-mono text-amber-600/70 mt-0.5">
            added by {nameFor(task.owner_id)}
          </p>
        )}
      </div>
      {isOwn && (
        <div className="flex flex-col flex-shrink-0">
          <button
            ref={editButton}
            onClick={() => {
              setDraft(task.content);
              setEditError(null);
              setEditing(true);
            }}
            aria-label="Edit note"
            disabled={editing || saving}
            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-amber-700 hover:text-amber-900 disabled:opacity-40"
          >
            <PencilIcon className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onDelete(task.id)}
            aria-label="Delete note"
            disabled={editing || saving}
            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-amber-600 hover:text-red-600 disabled:opacity-40"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </motion.div>
  );
}

function AddTaskInput({
  onAdd,
  accent,
}: {
  onAdd: (text: string) => void;
  accent: string;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onAdd(text);
    setValue("");
  };
  return (
    <div className="flex gap-2 mt-3 pt-3 border-t border-black/10">
      <input
        aria-label="New task"
        className="flex-1 bg-transparent text-sm placeholder-amber-500/60 focus:outline-none font-mono"
        style={{ color: accent }}
        placeholder="Add a task..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        maxLength={120}
      />
      <button
        aria-label="Add task"
        onClick={submit}
        disabled={!value.trim()}
        className="font-bold text-xl transition-opacity disabled:opacity-30"
        style={{ color: accent }}
      >
        +
      </button>
    </div>
  );
}

export default function StickyNote({
  open,
  onClose,
  userId,
  roomCode,
  partnerUserId,
  partnerName,
}: Props) {
  const dialogRef = useModalAccessibility<HTMLDivElement>(open, onClose);
  const {
    tab,
    setTab,
    showOptions,
    setShowOptions,
    colorIdx,
    setColorIdx,
    optionsRef,
    activeTasks,
    completedCount,
    addTask,
    toggleTask,
    editTask,
    deleteTask,
    clearCompleted,
    error,
    clearError,
  } = useStickyNotes(open, userId, roomCode);

  const color = NOTE_COLORS[colorIdx];

  // Everyone in a session is either you or the one other player, so this covers
  // every owner_id the shared board can show. The fallback matters for the
  // invited-non-friend case, where the partner's profile isn't readable.
  const nameFor = (id: string) => {
    if (id === userId) return "you";
    if (partnerUserId && id === partnerUserId) return partnerName || "partner";
    return "partner";
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-30 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Vertically-centered panel on the right. FriendsPanel and StatsPanel
              already went full-width-with-side-inset below sm; this one was left
              on a fixed w-80, which is 320px of a 360px screen pinned 16px from
              the right edge. */}
          <div className="fixed inset-x-2 sm:inset-x-auto sm:right-4 top-0 bottom-0 z-40 flex items-center pointer-events-none">
            <motion.div
              ref={dialogRef}
              id="notes-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="notes-panel-title"
              tabIndex={-1}
              className="pointer-events-auto w-full sm:w-80 flex flex-col rounded-2xl shadow-2xl overflow-hidden"
              style={{
                background: color.gradient,
                maxHeight: "min(600px, 85vh)",
              }}
              initial={{ x: 60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 60, opacity: 0 }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
            >
              {/* Tape decoration */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-4 bg-white/50 rounded-sm z-10" />

              {/* Header */}
              <div className="flex items-center justify-between px-4 pt-6 pb-3 border-b-2 border-black/10">
                <h2
                  id="notes-panel-title"
                  className="font-black font-mono tracking-widest text-sm"
                  style={{ color: color.accent }}
                >
                  SESSION NOTES
                </h2>
                <div className="flex items-center gap-0.5">
                  {/* Options (⋮) */}
                  <div className="relative" ref={optionsRef}>
                    <button
                      aria-label="Open note options"
                      aria-expanded={showOptions}
                      aria-controls="note-options-menu"
                      onClick={() => setShowOptions((o) => !o)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-lg font-bold transition-opacity hover:opacity-60"
                      style={{ color: color.accent }}
                      title="Options"
                    >
                      ⋮
                    </button>
                    {showOptions && (
                      <div
                        id="note-options-menu"
                        aria-label="Note options"
                        className="absolute right-0 top-8 z-50 bg-white rounded-xl shadow-2xl border border-gray-200 p-3 min-w-44"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <p className="text-xs font-bold text-gray-400 font-mono mb-2 uppercase tracking-wider">
                          Note Color
                        </p>
                        <div className="flex gap-2 mb-3">
                          {NOTE_COLORS.map((c, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setColorIdx(i);
                                setShowOptions(false);
                              }}
                              className={`w-6 h-6 rounded-full border-2 transition-all ${
                                colorIdx === i
                                  ? "border-gray-700 scale-110"
                                  : "border-transparent hover:border-gray-400"
                              }`}
                              style={{ background: c.gradient }}
                              title={c.label}
                              aria-label={`Use ${c.label} note color`}
                              aria-pressed={colorIdx === i}
                            />
                          ))}
                        </div>
                        <button
                          onClick={clearCompleted}
                          disabled={completedCount === 0}
                          className="w-full text-left text-xs font-mono text-gray-600 hover:text-red-500 py-1 disabled:opacity-30 transition-colors"
                        >
                          Clear completed ({completedCount})
                        </button>
                      </div>
                    )}
                  </div>
                  {/* Close */}
                  <button
                    data-autofocus
                    onClick={onClose}
                    aria-label="Close"
                    className="w-7 h-7 flex items-center justify-center rounded-none text-base transition-opacity hover:opacity-60"
                    style={{ color: color.accent }}
                  >
                    <CloseIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div role="tablist" aria-label="Task lists" className="flex border-b-2 border-black/10">
                {TASK_TABS.map((t) => (
                  <button
                    key={t}
                    id={`tasks-tab-${t}`}
                    role="tab"
                    aria-selected={tab === t}
                    aria-controls="tasks-tab-panel"
                    tabIndex={tab === t ? 0 : -1}
                    onKeyDown={(event) =>
                      handleTabKeyNavigation(
                        event,
                        TASK_TABS,
                        tab,
                        setTab,
                        (next) => `tasks-tab-${next}`,
                      )
                    }
                    onClick={() => setTab(t)}
                    className={`flex-1 py-2 text-xs font-mono font-bold transition-all ${
                      tab === t ? "border-b-2" : "opacity-50 hover:opacity-70"
                    }`}
                    style={{
                      color: color.accent,
                      borderColor: tab === t ? color.accent : "transparent",
                    }}
                  >
                    {t === "mine" ? (
                      "My Tasks"
                    ) : (
                      <>
                        Our Goals
                        {!roomCode && (
                          <span className="ml-1 text-[10px] opacity-60">
                            (join first)
                          </span>
                        )}
                      </>
                    )}
                  </button>
                ))}
              </div>

              {/* Progress bar */}
              {activeTasks.length > 0 && (
                <div className="px-4 pt-3 pb-1">
                  <div
                    className="flex justify-between text-[10px] font-mono mb-1"
                    style={{ color: color.accent, opacity: 0.6 }}
                  >
                    <div className="flex items-center gap-2">
                      <span>
                        {completedCount}/{activeTasks.length} done
                      </span>
                      {completedCount > 0 && (
                        <button
                          onClick={clearCompleted}
                          className="hover:opacity-100 opacity-60 transition-opacity"
                          style={{ color: color.accent }}
                        >
                          Clean
                        </button>
                      )}
                    </div>
                    <span>
                      {Math.round((completedCount / activeTasks.length) * 100)}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Task completion"
                    aria-valuemin={0}
                    aria-valuemax={activeTasks.length}
                    aria-valuenow={completedCount}
                    className="w-full h-1.5 rounded-full overflow-hidden bg-black/10"
                  >
                    <motion.div
                      className="h-full rounded-full bg-emerald-600"
                      initial={{ width: 0 }}
                      animate={{
                        width: `${(completedCount / activeTasks.length) * 100}%`,
                      }}
                      transition={{ ease: "easeOut", duration: 0.4 }}
                    />
                  </div>
                </div>
              )}

              {/* Task list */}
              {error && (
                <div
                  role="alert"
                  className="mx-4 mb-1 flex items-start gap-2 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs"
                >
                  <span className="flex-1">{error}</span>
                  <button
                    onClick={clearError}
                    aria-label="Dismiss error"
                    className="font-bold hover:opacity-70"
                  >
                    <CloseIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div
                id="tasks-tab-panel"
                role="tabpanel"
                aria-labelledby={`tasks-tab-${tab}`}
                className="flex-1 overflow-y-auto px-4 py-2"
              >
                {tab === "shared" && !roomCode ? (
                  <p
                    className="text-sm font-mono text-center py-8 leading-relaxed"
                    style={{ color: color.accent, opacity: 0.6 }}
                  >
                    Start a session with
                    <br />
                    your partner first to
                    <br />
                    share goals!
                  </p>
                ) : activeTasks.length === 0 ? (
                  <p
                    className="text-sm font-mono text-center py-8"
                    style={{ color: color.accent, opacity: 0.6 }}
                  >
                    {tab === "mine"
                      ? "No tasks yet. Add one below!"
                      : "No shared goals yet!"}
                  </p>
                ) : (
                  <AnimatePresence mode="popLayout">
                    {activeTasks.map((task) => (
                      <TaskRow
                        key={`${roomCode}:${tab}:${task.id}`}
                        task={task}
                        isOwn={task.owner_id === userId}
                        nameFor={nameFor}
                        onToggle={toggleTask}
                        onEdit={editTask}
                        onDelete={deleteTask}
                      />
                    ))}
                  </AnimatePresence>
                )}
              </div>

              {/* Add task */}
              <div className="px-4 pb-4">
                {(tab === "mine" || (tab === "shared" && roomCode)) && (
                  <AddTaskInput
                    onAdd={(text) => addTask(text, tab === "shared")}
                    accent={color.accent}
                  />
                )}
              </div>

              {/* Notebook lines decoration */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10">
                {Array.from({ length: 20 }, (_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 h-px"
                    style={{
                      top: `${90 + i * 28}px`,
                      backgroundColor: color.accent,
                    }}
                  />
                ))}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
