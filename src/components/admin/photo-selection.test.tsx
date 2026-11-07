import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  copyPhotosToWebGallery: vi.fn(),
  deletePhotos: vi.fn(),
  setGalleryCover: vi.fn(),
}));
vi.mock("@/app/admin/actions", () => actions);
vi.mock("@/app/admin/highlight-actions", () => ({ setHighlightPin: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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

describe("Escape", () => {
  it("clears the selection, but not while a dialog has it", () => {
    setup();
    pick(0);
    const dialog = document.body.appendChild(document.createElement("dialog"));
    dialog.setAttribute("open", "");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("toolbar")).toHaveTextContent("Vybráno: 1 fotka");

    dialog.remove();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("copying the selection to a web gallery", () => {
  it("offers nothing when there is no web gallery", () => {
    setup(2, []);
    pick(0);
    expect(screen.queryByLabelText("Webová galerie")).toBeNull();
  });

  const startCopy = (count: number) => {
    setup(count);
    for (let index = 0; index < count; index++) pick(index);
    fireEvent.change(screen.getByLabelText("Webová galerie"), { target: { value: "web" } });
    fireEvent.click(screen.getByRole("button", { name: "Kopírovat na web" }));
  };
  const result = (copied: number, skipped = 0, failed = 0) => ({ copied, skipped, failed });

  it("waits for a target, then reports what happened and where it went", async () => {
    actions.copyPhotosToWebGallery.mockResolvedValue(result(1, 1));
    setup();
    pick(0);
    pick(1);

    const button = screen.getByRole("button", { name: "Kopírovat na web" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Webová galerie"), { target: { value: "web" } });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Zkopírováno na web: 1 fotka, přeskočeno: 1 fotka",
    );
    expect(screen.getByRole("link", { name: /Eliška a Martin/ })).toHaveAttribute(
      "href",
      "/admin/g/web",
    );
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("copies in chunks and counts them as they land, past what one call may take", async () => {
    const answers: ((value: ReturnType<typeof result>) => void)[] = [];
    actions.copyPhotosToWebGallery.mockImplementation(
      () => new Promise((resolve) => answers.push(resolve)),
    );
    startCopy(61);

    expect(await screen.findByRole("button", { name: "Kopíruji 0 / 61" })).toBeDisabled();
    expect(screen.getByRole("progressbar")).toHaveAttribute("max", "61");
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(actions.copyPhotosToWebGallery).toHaveBeenLastCalledWith("web", [
      "p0",
      "p1",
      "p2",
      "p3",
    ]);

    act(() => answers[0]!(result(4)));
    expect(await screen.findByRole("button", { name: "Kopíruji 4 / 61" })).toBeDisabled();
    for (let answered = 1; answered < 16; answered++) {
      await waitFor(() => expect(answers).toHaveLength(answered + 1));
      act(() => answers[answered]!(result(answered < 15 ? 4 : 1)));
    }

    expect(await screen.findByRole("status")).toHaveTextContent("Zkopírováno na web: 61 fotek");
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByRole("toolbar")).toBeNull();
    // Once, not per chunk: it renders the whole page.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("while copying, Escape does not drop the selection and leaving the page asks", async () => {
    const answers: ((value: ReturnType<typeof result>) => void)[] = [];
    actions.copyPhotosToWebGallery.mockImplementation(
      () => new Promise((resolve) => answers.push(resolve)),
    );
    startCopy(2);
    await screen.findByRole("button", { name: "Kopíruji 0 / 2" });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("toolbar")).toHaveTextContent("Vybráno: 2 fotky");
    expect(fireEvent(window, new Event("beforeunload", { cancelable: true }))).toBe(false);

    act(() => answers[0]!(result(2)));
    await screen.findByRole("link", { name: /Eliška a Martin/ });
    expect(fireEvent(window, new Event("beforeunload", { cancelable: true }))).toBe(true);
  });

  it("stops on a failed call, says how far it got, and keeps the selection to try again", async () => {
    actions.copyPhotosToWebGallery
      .mockResolvedValueOnce(result(4))
      .mockRejectedValueOnce(new Error("offline"));
    startCopy(10);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Zkopírováno na web: 4 fotky. Kopírování se přerušilo. Zkus to znovu",
    );
    expect(actions.copyPhotosToWebGallery).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("toolbar")).toHaveTextContent("Vybráno: 10 fotek");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Kopírovat na web" })).toBeEnabled(),
    );
  });

  it("keeps the selection when some photos did not copy", async () => {
    actions.copyPhotosToWebGallery.mockResolvedValue(result(1, 0, 1));
    startCopy(2);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "nepovedlo se: 1 fotka. Zkus to znovu",
    );
    expect(screen.getByRole("toolbar")).toHaveTextContent("Vybráno: 2 fotky");
  });

  it("closes the report", async () => {
    actions.copyPhotosToWebGallery.mockResolvedValue(result(1));
    startCopy(1);
    await screen.findByRole("link", { name: /Eliška a Martin/ });
    fireEvent.click(screen.getByRole("button", { name: "Zavřít" }));
    expect(screen.queryByRole("link", { name: /Eliška a Martin/ })).toBeNull();
  });
});
