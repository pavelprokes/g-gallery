import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// The panel's module also exports the server-action forms; the field under
// test uses none of them.
// The custom image loader needs env the unit tests do not have.
// eslint-disable-next-line @next/next/no-img-element -- a stand-in, never rendered for real
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/app/admin/chapter-actions", () => ({ deleteChapter: vi.fn(), updateChapter: vi.fn() }));

import {
  ChapterTitleField,
  GalleryChapterPanel,
  StartChapterDetails,
} from "./gallery-chapter-panel";

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

describe("StartChapterDetails", () => {
  it("renders its form only once opened — the timeline has one on every photo", () => {
    const { container } = render(
      <StartChapterDetails summary="Tady začíná kapitola" action={vi.fn()} />,
    );
    expect(screen.queryByRole("textbox")).toBeNull();

    const details = container.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));

    expect(screen.getByRole("textbox", { name: "Název kapitoly" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hostina" })).toBeInTheDocument();
  });
});

describe("GalleryChapterPanel", () => {
  const chapter = (id: string, title: string) => ({
    id,
    anchor: id,
    title,
    translations: {},
    count: 3,
    firstPhoto: { objectKey: `k/${id}.jpg`, thumbObjectKey: null, fileName: `${id}.jpg` },
  });

  it("warns on both chapters that share a name, and on no other", () => {
    render(
      <GalleryChapterPanel
        chapters={[
          chapter("a", "Večerní zábava"),
          chapter("b", "Obřad"),
          chapter("c", "večerní zábava "),
        ]}
        shareUrl="/g/t/slug"
        timelineHref="?timeline=1"
        timelineActive={false}
      />,
    );
    expect(screen.getAllByText(/Stejný název má i jiná kapitola/)).toHaveLength(2);
    // An id anchor (pre-slug chapter) is not shown as a cryptic #hash.
    expect(
      screen.getAllByRole("button", { name: /Kopírovat odkaz rovnou na kapitolu/ })[0],
    ).toHaveTextContent("Odkaz na kapitolu");
  });
});
