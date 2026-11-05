import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  copyPhotosToWebGallery: vi.fn(),
  deletePhotos: vi.fn(),
  setGalleryCover: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => actions);
vi.mock("@/app/admin/highlight-actions", () => ({ setHighlightPin: vi.fn() }));

import { PhotoSelection } from "./photo-selection";

const tiles = (count: number) =>
  Array.from({ length: count }, (_, index) => (
    <label key={index}>
      <input type="checkbox" name="photo" value={`p${index}`} aria-label={`fotka ${index}`} />
    </label>
  ));

const setup = (count = 2, webGalleries = [{ id: "web", title: "Web: Eliška a Martin" }]) =>
  render(
    <PhotoSelection galleryId="g" pinnedCount={0} maxPinned={6} webGalleries={webGalleries}>
      <div>{tiles(count)}</div>
    </PhotoSelection>,
  );

const pick = (index: number) => fireEvent.click(screen.getByLabelText(`fotka ${index}`));

beforeEach(() => vi.clearAllMocks());

describe("copying the selection to a web gallery", () => {
  it("offers nothing when there is no web gallery", () => {
    setup(2, []);
    pick(0);
    expect(screen.queryByLabelText("Webová galerie")).toBeNull();
  });

  it("waits for a target, then copies the picked photos and reports what happened", async () => {
    actions.copyPhotosToWebGallery.mockResolvedValue({ copied: 1, skipped: 1, failed: 0 });
    setup();
    pick(0);
    pick(1);

    const button = screen.getByRole("button", { name: "Kopírovat na web" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Webová galerie"), { target: { value: "web" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    await waitFor(() =>
      expect(actions.copyPhotosToWebGallery).toHaveBeenCalledWith("web", ["p0", "p1"]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Zkopírováno na web");
  });

  it("says why it will not copy more than one action can take", () => {
    setup(61);
    for (let index = 0; index < 61; index++) pick(index);
    fireEvent.change(screen.getByLabelText("Webová galerie"), { target: { value: "web" } });
    expect(screen.getByRole("button", { name: "Kopírovat na web" })).toBeDisabled();
    expect(screen.getByText(/Najednou nejvýš 60/)).toBeInTheDocument();
  });
});
