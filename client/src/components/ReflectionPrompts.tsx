"use client";
import { useId, useState } from "react";
const questions = ["What helped you focus?", "What got in your way?", "What would you try next time?"];

export default function ReflectionPrompts({ disabled, descriptionId }: { disabled: boolean; descriptionId: string }) {
  const id = useId();
  const [question, setQuestion] = useState("");
  return <div className="space-y-1">
    <label htmlFor={id} className="block text-xs text-muted">Optional reflection prompt</label>
    <select id={id} value={question} disabled={disabled} onChange={event => setQuestion(event.target.value)}
      className="min-h-11 w-full min-w-0 rounded-lg border border-line bg-surface px-2 text-xs text-ink disabled:opacity-50">
      <option value="">No prompt</option>
      {questions.map(value => <option key={value} value={value}>{value}</option>)}
    </select>
    <p id={descriptionId} aria-live="polite" className="text-xs text-muted">{question ? `${question} Only your writing is saved.` : "Choose a question for inspiration. Only your writing is saved."}</p>
  </div>;
}
