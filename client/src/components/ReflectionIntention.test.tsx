import { fireEvent,render,screen } from "@testing-library/react";
import { expect,it,vi } from "vitest";
import ReflectionIntention from "./ReflectionIntention";
it("requires an explicit action and passes full text without persistence", () => {
  const prepare = vi.fn(() => true), text = "Private thought ".repeat(30);
  render(<ReflectionIntention text={text} onPrepare={prepare} />); expect(prepare).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button")); expect(prepare).toHaveBeenCalledWith(text); expect(screen.getByRole("status")).toHaveTextContent(/Only Save intention shares it/);
});
it("reports refusal without claiming a draft was prepared", () => {
  render(<ReflectionIntention text="note" onPrepare={() => false} />); fireEvent.click(screen.getByRole("button"));
  expect(screen.getByRole("status")).toHaveTextContent(/Nothing was replaced/);
});
