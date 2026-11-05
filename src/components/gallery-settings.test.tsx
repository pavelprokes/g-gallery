import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const updateGallery = vi.hoisted(() => vi.fn());
vi.mock("@/app/admin/actions", () => ({ updateGallery }));

import { GallerySettings } from "./gallery-settings";

const setup = (webSlug: string | null = null) => {
  render(
    <GallerySettings
      galleryId="g"
      title="Svatba"
      eventDate={null}
      description={null}
      translations={{} as never}
      webSlug={webSlug}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Přejmenovat" }));
};

const submit = () => fireEvent.submit(document.getElementById("gallery-title")!.closest("form")!);

beforeEach(() => vi.clearAllMocks());

describe("GallerySettings", () => {
  it("shows the current web slug", () => {
    setup("eliska-a-martin-2026");
    expect(screen.getByLabelText("Adresa na webu")).toHaveValue("eliska-a-martin-2026");
  });

  it("stays open and says so when the slug is taken", async () => {
    updateGallery.mockResolvedValue({ error: "WEB_SLUG_TAKEN" });
    setup();
    submit();
    expect(await screen.findByText("Tuhle adresu už má jiná galerie.")).toBeInTheDocument();
  });

  it("closes after saving", async () => {
    updateGallery.mockResolvedValue(undefined);
    setup();
    submit();
    await waitFor(() => expect(screen.getByRole("button", { name: "Přejmenovat" })).toBeVisible());
  });
});
