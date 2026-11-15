"use client";

import { useState } from "react";
import { useKeepAwakePreference, useWakeLockSupported } from "@/hooks/useKeepAwake";

export default function KeepAwakeSetting({ userId, failed }: { userId: string; failed: boolean }) {
  const { enabled, setEnabled } = useKeepAwakePreference(userId);
  const supported = useWakeLockSupported();
  const [temporary, setTemporary] = useState(false);
  return (
    <div className="w-full max-w-xs">
      <label className={`flex items-center justify-center gap-2 min-h-11 text-xs font-semibold text-muted ${supported ? "cursor-pointer" : "opacity-60"}`}>
        <input type="checkbox" checked={supported && enabled} disabled={!supported}
          onChange={event => setTemporary(!setEnabled(event.target.checked))}
          className="h-4 w-4 accent-accent" />
        Keep screen awake while focusing
      </label>
      {!supported
        ? <p className="text-center text-xs text-faint">This browser can&apos;t keep the screen awake.</p>
        : failed && enabled
          ? <p role="status" className="text-center text-xs text-muted">Your browser didn&apos;t allow it right now, for example in battery saver. Duodoro will try again when you return to this tab.</p>
          : <p className="text-center text-xs text-faint">Only on this device, only during focus.</p>}
      {temporary && <p role="status" className="text-center text-xs text-muted mt-1">Browser storage is unavailable, so this applies until you reload.</p>}
    </div>
  );
}
