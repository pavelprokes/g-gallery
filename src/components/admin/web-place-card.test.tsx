import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WebPlaceCard } from "./web-place-card";
import type { PlaceGallery, WebPlace } from "@/lib/web-place-view";

vi.mock("@/components/admin/cover-thumb", () => ({
  CoverThumb: ({ cover }: { cover: { objectKey: string } | null }) => (
    <span data-testid="thumb">{cover?.objectKey ?? "prázdné"}</span>
  ),
}));

const place: WebPlace = {
  key: "misto-homepage",
  label: "Homepage",
  where: "/",
  positions: ["Hero", "Citát"],
  landscape: true,
  coverFirst: true,
};

const gallery = (over: Partial<PlaceGallery> = {}): PlaceGallery => ({
  id: "g1",
  title: "Web: Homepage",
  status: "PUBLISHED",
  coverPhotoId: "b",
  photoCount: 2,
  photos: [
    {
      id: "a",
      objectKey: "k/a.jpg",
      thumbObjectKey: null,
      placeholder: null,
      fileName: "a.jpg",
      width: 4000,
      height: 6000,
    },
    {
      id: "b",
      objectKey: "k/b.jpg",
      thumbObjectKey: null,
      placeholder: null,
      fileName: "b.jpg",
      width: 6000,
      height: 4000,
    },
  ],
  ...over,
});

const setup = (g: PlaceGallery | null, options = [{ id: "g2", title: "Web: Jiná" }]) =>
  render(
    <WebPlaceCard
      websiteBase="https://web.example"
      place={place}
      gallery={g}
      options={options}
      assign={vi.fn()}
      clear={vi.fn()}
      create={vi.fn()}
    />,
  );

describe("WebPlaceCard", () => {
  it("offers to create or choose a gallery for an empty place", () => {
    setup(null);
    expect(screen.getByText("Prázdné, web ukazuje původní fotky")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Založit galerii" })).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: "Galerie pro místo Homepage" });
    expect(within(select).getByRole("option", { name: "Web: Jiná" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Odebrat z místa" })).toBeNull();
  });

  it("shows which photo does what, with the cover as the hero", () => {
    setup(gallery());
    expect(screen.getByText("Na webu")).toBeInTheDocument();
    expect(screen.getAllByTestId("thumb").map((tile) => tile.textContent)).toEqual([
      "k/b.jpg",
      "k/a.jpg",
    ]);
    expect(screen.getByText(/Hero je titulní fotka galerie/)).toBeInTheDocument();
    expect(screen.getByText("Web: Homepage")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Založit galerii" })).toBeNull();
  });

  it("warns about a portrait in a landscape place", () => {
    setup(gallery());
    expect(screen.getByText("Na výšku")).toBeInTheDocument();
    expect(screen.getByText(/Tady fungují jen fotky na šířku/)).toHaveTextContent(
      "Na výšku: 1 fotka",
    );
  });

  it("says a draft is not on the website", () => {
    setup(gallery({ status: "DRAFT" }));
    expect(screen.getByText("Koncept, web ukazuje původní fotky")).toBeInTheDocument();
  });

  it("does not offer an empty list of galleries", () => {
    setup(gallery(), []);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("links the place's title and a button to the website, and the gallery as the main button", () => {
    setup(gallery());
    const onWebsite = screen.getByRole("link", { name: /Na webu/ });
    expect(onWebsite).toHaveAttribute("href", `https://web.example${place.where}`);
    expect(onWebsite).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: place.label })).toHaveAttribute(
      "href",
      `https://web.example${place.where}`,
    );
    expect(screen.getByRole("link", { name: "Otevřít galerii" })).toHaveAttribute(
      "href",
      "/admin/g/g1",
    );
  });
});
