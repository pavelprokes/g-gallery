import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The panel's module also exports the server-action forms; the field under
// test uses none of them.
vi.mock("@/app/admin/chapter-actions", () => ({ deleteChapter: vi.fn(), updateChapter: vi.fn() }));

import { ChapterTitleField } from "./gallery-chapter-panel";

describe("ChapterTitleField", () => {
  it("fills the title with a tapped preset, and says which one is chosen", () => {
    render(
      <form>
        <ChapterTitleField label="Název kapitoly" />
      </form>,
    );
    const input = screen.getByRole("textbox", { name: "Název kapitoly" });
    const obrad = screen.getByRole("button", { name: "Obřad" });

    fireEvent.click(obrad);

    expect(input).toHaveValue("Obřad");
    expect(obrad).toHaveAttribute("aria-pressed", "true");
    // A button, not a submit: tapping a preset never saves on its own.
    expect(obrad).toHaveAttribute("type", "button");
  });

  it("keeps a custom title typed by hand", () => {
    render(<ChapterTitleField label="Název kapitoly" defaultValue="Rozbíjení talíře" />);
    expect(screen.getByRole("textbox", { name: "Název kapitoly" })).toHaveValue("Rozbíjení talíře");
    expect(screen.getByRole("button", { name: "Obřad" })).toHaveAttribute("aria-pressed", "false");
  });
});
