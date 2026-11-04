import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NameSheet, resetNameDraft } from "@/components/name-sheet";

function Harness({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  return (
    <NameSheet
      title="Your name"
      hint="Hint"
      placeholder="Name"
      value={value}
      onChange={setValue}
      onSubmit={onDone}
      onDismiss={onDone}
    >
      <button type="submit">Save</button>
    </NameSheet>
  );
}

describe("NameSheet's draft", () => {
  afterEach(() => resetNameDraft());

  it("survives a tap on the backdrop and comes back on the next opening", () => {
    const first = render(<Harness onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Petra" } });
    fireEvent.click(screen.getByRole("dialog"));
    first.unmount();

    render(<Harness onDone={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Petra");
  });

  it("is forgotten once the name is submitted", () => {
    const first = render(<Harness onDone={() => {}} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Petra" } });
    fireEvent.click(screen.getByRole("dialog"));
    first.unmount();

    const second = render(<Harness onDone={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    second.unmount();

    render(<Harness onDone={() => {}} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("");
  });

  it("locks the page behind it while open", () => {
    const { unmount } = render(<Harness onDone={() => {}} />);
    expect(document.documentElement.style.overflow).toBe("hidden");
    unmount();
    expect(document.documentElement.style.overflow).toBe("");
  });
});
