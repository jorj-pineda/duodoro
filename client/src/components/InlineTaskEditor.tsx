"use client";
import { useRef, useState } from "react";

interface Props {
  content: string;
  unavailable?: string;
  label: string;
  variant: "home" | "note";
  onSave: (content: string) => Promise<string | null>;
  onClose: () => void;
  onSavingChange: (saving: boolean) => void;
}

export default function InlineTaskEditor({
  content, unavailable, label, variant, onSave, onClose, onSavingChange,
}: Props) {
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const note = variant === "note";
  const save = async () => {
    const text = draft.trim();
    if (unavailable || savingRef.current || !text || text.length > 500) return;
    if (text === content) {
      onClose();
      return;
    }
    savingRef.current = true;
    setSaving(true);
    onSavingChange(true);
    setError(null);
    try {
      const failure = await onSave(text);
      if (failure) setError(failure);
      else onClose();
    } catch {
      setError("Couldn't save your changes. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
      onSavingChange(false);
    }
  };
  const buttonClass = `min-h-11 sm:min-h-9 px-2 text-xs disabled:opacity-50 ${note ? "font-mono text-amber-900" : "text-ink"}`;
  return (
    <div
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.preventDefault();
          if (!savingRef.current) onClose();
        }
      }}
    >
      <textarea
        autoFocus
        aria-label={label}
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
        className={`w-full rounded border p-1.5 text-sm resize-y disabled:opacity-60 ${
          note
            ? "border-amber-600 bg-white/60 font-mono text-amber-900 focus:outline-amber-700"
            : "border-line bg-bg text-ink focus:outline-accent"
        }`}
      />
      <div className="flex gap-2 mt-1">
        <button
          onClick={() => void save()}
          disabled={Boolean(unavailable) || saving || !draft.trim() || draft.trim().length > 500}
          className={`${buttonClass} font-bold`}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onClose} disabled={saving} className={buttonClass}>
          Cancel
        </button>
      </div>
      {(unavailable || error) && (
        <p role="alert" className={`text-xs mt-1 ${note ? "text-red-700" : "text-danger"}`}>
          {unavailable || error}
        </p>
      )}
    </div>
  );
}
