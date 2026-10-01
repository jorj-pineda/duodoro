"use client";
import { useRef, useState } from "react";
import InlineTaskEditor from "./InlineTaskEditor";
import { motion, AnimatePresence } from "framer-motion";
import type { Task } from "@/lib/types";
import { CloseIcon, PencilIcon } from "./Icons";

interface Props {
  tasks: Task[];
  pendingTasks: Task[];
  completedTasks: Task[];
  newTask: string;
  setNewTask: (v: string) => void;
  addTask: () => void;
  toggleTask: (id: string, done: boolean) => void;
  deleteTask: (id: string) => void;
  editTask: (id: string, content: string) => Promise<string | null>;
  clearCompleted: () => void;
  error?: string | null;
  onDismissError?: () => void;
}

function GoalRow({ task, missing, onEditingChange, toggleTask, deleteTask, editTask }: {
  task: Task;
  missing: boolean;
  onEditingChange: (task: Task, editing: boolean) => void;
} & Pick<Props, "toggleTask" | "deleteTask" | "editTask">) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const finishEditing = () => {
    setEditing(false);
    onEditingChange(task, false);
    window.requestAnimationFrame(() => editButton.current?.focus());
  };
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      className="flex items-start gap-2.5 group"
    >
      <button
        onClick={() => toggleTask(task.id, !task.is_done)}
        disabled={saving || missing}
        aria-label={`Mark ${task.content} ${task.is_done ? "incomplete" : "complete"}`}
        className={`flex-shrink-0 mt-1 w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors ${task.is_done
          ? "border-go bg-go" : "border-line hover:border-go"}`}
      >
        {task.is_done && <span className="text-white text-[10px]">✓</span>}
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <InlineTaskEditor
            content={task.content}
            unavailable={missing ? "This goal was deleted elsewhere. Copy your draft or cancel." : undefined}
            label="Edit goal text"
            variant="home"
            onSave={(content) => editTask(task.id, content)}
            onClose={finishEditing}
            onSavingChange={setSaving}
          />
        ) : (
          <p className={`text-sm break-words whitespace-pre-wrap ${task.is_done ? "text-faint line-through" : "text-ink"}`}>
            {task.content}
          </p>
        )}
      </div>
      <div className="flex flex-col flex-shrink-0">
        <button
          ref={editButton}
          onClick={() => {
            setEditing(true);
            onEditingChange(task, true);
          }}
          aria-label="Edit goal"
          disabled={editing || saving || missing}
          className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-faint hover:text-ink disabled:opacity-40"
        >
          <PencilIcon className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => deleteTask(task.id)}
          aria-label="Delete task"
          disabled={editing || saving || missing}
          className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center text-faint hover:text-danger disabled:opacity-40"
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

export default function TaskSection({
  tasks,
  pendingTasks,
  completedTasks,
  newTask,
  setNewTask,
  addTask,
  toggleTask,
  deleteTask,
  editTask,
  clearCompleted,
  error,
  onDismissError,
}: Props) {
  const newGoalInput = useRef<HTMLInputElement>(null);
  const [editingTasks, setEditingTasks] = useState<Task[]>([]);
  const onEditingChange = (task: Task, editing: boolean) => {
    setEditingTasks((rows) => editing
      ? [...rows.filter((row) => row.id !== task.id), task]
      : rows.filter((row) => row.id !== task.id));
    if (!editing && !tasks.some((row) => row.id === task.id)) {
      window.requestAnimationFrame(() => newGoalInput.current?.focus());
    }
  };
  const visibleTasks = [
    ...pendingTasks, ...completedTasks,
    ...editingTasks.filter((draft) => !tasks.some((row) => row.id === draft.id)),
  ];
  return (
    <div className="bg-surface rounded-2xl border border-line p-4">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 mb-3 px-3 py-2 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs"
        >
          <span className="flex-1">{error}</span>
          {onDismissError && (
            <button
              onClick={onDismissError}
              aria-label="Dismiss error"
              className="font-bold hover:opacity-70"
            >
              <CloseIcon className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-faint uppercase tracking-wider">
          Goals
        </h2>
        {tasks.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-faint">
              {completedTasks.length}/{tasks.length} done
            </span>
            {completedTasks.length > 0 && (
              <button
                onClick={clearCompleted}
                className="text-[10px] text-faint hover:text-danger transition-colors"
              >
                Clean
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {visibleTasks.map((task) => (
            <GoalRow
              key={task.id}
              task={task}
              missing={!tasks.some((row) => row.id === task.id)}
              onEditingChange={onEditingChange}
              toggleTask={toggleTask}
              deleteTask={deleteTask}
              editTask={editTask}
            />
          ))}
        </AnimatePresence>
      </div>

      {visibleTasks.length === 0 && (
        <p className="text-faint text-xs text-center py-3">
          Add goals for your focus session
        </p>
      )}

      <div className="flex gap-2 mt-3 pt-3 border-t border-line">
        <input
          ref={newGoalInput}
          aria-label="New goal"
          className="flex-1 bg-transparent text-sm text-ink placeholder-faint focus:outline-none"
          placeholder="Add a goal..."
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          maxLength={120}
        />
        <button
          aria-label="Add goal"
          onClick={addTask}
          disabled={!newTask.trim()}
          className="text-accent font-bold text-lg disabled:opacity-30 transition-opacity"
        >
          +
        </button>
      </div>
    </div>
  );
}
