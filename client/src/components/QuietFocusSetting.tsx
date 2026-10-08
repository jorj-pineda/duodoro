"use client";

import { useState } from "react";
import { useQuietFocus } from "@/hooks/useQuietFocus";

export default function QuietFocusSetting({ userId }: { userId: string }) {
  const { enabled, setEnabled } = useQuietFocus(userId);
  const [temporary, setTemporary] = useState(false);
  return (
    <div className="w-full max-w-xs">
      <label className="flex items-center justify-center gap-2 min-h-11 cursor-pointer text-xs font-semibold text-muted">
        <input type="checkbox" checked={enabled} onChange={event => setTemporary(!setEnabled(event.target.checked))}
          className="h-4 w-4 accent-accent" />
        Quiet focus mode
      </label>
      <p className="text-center text-xs text-faint">Fewer controls while focusing. Full controls return on breaks.</p>
      {temporary && <p role="status" className="text-center text-xs text-muted mt-1">Saved for this page only. Browser storage is unavailable.</p>}
    </div>
  );
}
