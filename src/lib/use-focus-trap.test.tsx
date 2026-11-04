import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useFocusTrap } from "@/lib/use-focus-trap";

// jsdom does no layout, so `offsetParent` is null for everything; the trap's
// visibility filter needs it to name something.
Object.defineProperty(HTMLElement.prototype, "offsetParent", {
  configurable: true,
  get() {
    return this.parentNode;
  },
});

function Trap({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  return (
    <div ref={ref} tabIndex={-1} data-testid="trap">
      {children}
    </div>
  );
}

describe("useFocusTrap", () => {
  it("counts a textarea, a select, a video with controls and a summary as stops", () => {
    const { getByTestId } = render(
      <Trap>
        <textarea data-testid="first" />
        <select />
        <video controls />
        <details>
          <summary data-testid="last">More</summary>
        </details>
      </Trap>,
    );
    // Opens on the first stop — a textarea was not one before.
    expect(document.activeElement).toBe(getByTestId("first"));
    getByTestId("last").focus();
    fireEvent.keyDown(getByTestId("trap"), { key: "Tab" });
    expect(document.activeElement).toBe(getByTestId("first"));
  });

  it("keeps focus on the container when every stop is inert", () => {
    const { getByTestId } = render(
      <Trap>
        <div inert>
          <button type="button">Close</button>
        </div>
      </Trap>,
    );
    const trap = getByTestId("trap");
    expect(document.activeElement).toBe(trap);
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    trap.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("wraps Shift+Tab from the container itself to the last stop", () => {
    const { getByTestId } = render(
      <Trap>
        <button type="button">One</button>
        <button type="button" data-testid="two">
          Two
        </button>
      </Trap>,
    );
    const trap = getByTestId("trap");
    trap.focus();
    fireEvent.keyDown(trap, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(getByTestId("two"));
  });
});
