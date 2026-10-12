"use client";
import { useState } from "react";
import { useModalAccessibility } from "@/hooks/useModalAccessibility";

export default function KeyboardShortcuts({ open, onClose, enabled, onEnabledChange }: {
  open: boolean; onClose: () => void; enabled: boolean; onEnabledChange: (enabled: boolean) => boolean;
}) {
  const ref = useModalAccessibility<HTMLDivElement>(open, onClose);
  const [temporary, setTemporary] = useState(false);
  if (!open) return null;
  return <div className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1}
      onClick={event => event.stopPropagation()} className="w-full max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-4 text-ink space-y-4">
      <div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg">Keyboard shortcuts</h2>
        <button data-autofocus onClick={onClose} aria-label="Close keyboard shortcuts" className="min-h-11 min-w-11 text-muted">×</button></div>
      <label className="flex items-center gap-2 min-h-11 text-sm"><input type="checkbox" checked={enabled}
        onChange={event => setTemporary(!onEnabledChange(event.target.checked))} />Enable keyboard shortcuts</label>
      <dl className="text-sm space-y-2">
        {[['S', 'Start / Go again in a connected room'], ['T', 'Open stats from Home or a room'], ['Q', 'Toggle quiet focus in a room'], ['?', 'Open this help']].map(([key, text]) =>
          <div key={key} className="flex gap-3"><dt><kbd className="inline-block min-w-8 border border-line rounded px-2 text-center">{key}</kbd></dt><dd>{text}</dd></div>)}
      </dl>
      <p className="text-xs text-muted">Shortcuts pause while typing or using a dialog or menu. S works only when Start or Go again is available. You can turn shortcuts off here at any time.</p>
      {temporary && <p role="status" className="text-xs text-muted">Saved for this page only. Browser storage is unavailable.</p>}
    </div>
  </div>;
}
