import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { useCalendarExportPreferences } from "./useCalendarExportPreferences";
beforeEach(() => localStorage.clear()); afterEach(() => vi.restoreAllMocks());
it("starts reminders off, remembers explicit changes across mounts and isolates accounts", () => {
  const first = renderHook(() => useCalendarExportPreferences("a"));
  expect(first.result.current).toMatchObject({ minutes:25,reminder:0 });
  act(() => first.result.current.save({ minutes:50,reminder:15 })); first.unmount();
  const next = renderHook(({ id }) => useCalendarExportPreferences(id),{ initialProps:{ id:"a" } });
  expect(next.result.current).toMatchObject({ minutes:50,reminder:15 }); next.rerender({ id:"b" });
  expect(next.result.current).toMatchObject({ minutes:25,reminder:0 });
});
it("rejects corrupt or unsupported values", () => {
  localStorage.setItem("duodoro:calendar-export:bad",'{"minutes":26,"reminder":5}');
  const view = renderHook(() => useCalendarExportPreferences("bad")); expect(view.result.current.reminder).toBe(0);
  act(() => view.result.current.save({ minutes:25,reminder:NaN })); expect(view.result.current.reminder).toBe(0);
});
it("shares preferences across mounted cards and tabs, and resets on storage clear", () => {
  const a = renderHook(() => useCalendarExportPreferences("same")); const b = renderHook(() => useCalendarExportPreferences("same"));
  act(() => a.result.current.save({ minutes:60,reminder:10 })); expect(b.result.current.reminder).toBe(10);
  act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent("storage",{ key:null })); });
  expect(b.result.current).toMatchObject({ minutes:25,reminder:0 });
});
it("uses memory if browser storage is blocked", () => {
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(() => { throw new Error("blocked"); });
  const view = renderHook(() => useCalendarExportPreferences("blocked"));
  act(() => view.result.current.save({ minutes:50,reminder:5 })); view.unmount();
  expect(renderHook(() => useCalendarExportPreferences("blocked")).result.current.reminder).toBe(5);
});
it("keeps the server frame independent of browser storage", () => {
  localStorage.setItem("duodoro:calendar-export:ssr",'{"minutes":60,"reminder":30}');
  function View() { const value = useCalendarExportPreferences("ssr"); return <p>{value.minutes}:{value.reminder}</p>; }
  expect(renderToString(<View />)).toContain('25<!-- -->:<!-- -->0');
});
