import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/admin/manual-order-actions", () => ({ moveGalleryPhoto: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: { alt: string }) => <img alt={props.alt} />,
}));

import { ManualOrderBoard, type BoardPhoto } from "./manual-order-board";

const photo = (id: string): BoardPhoto => ({
  id,
  objectKey: `${id}.jpg`,
  thumbObjectKey: null,
  fileName: `${id}.jpg`,
  placeholder: null,
  isVideo: false,
});
const board = (photos: BoardPhoto[]) => (
  <ManualOrderBoard galleryId="g" doneHref="/done" photos={photos} chapterStarts={{}} />
);
const shown = () => screen.getAllByRole("img").map((image) => image.getAttribute("alt"));

afterEach(() => vi.restoreAllMocks());

describe("ManualOrderBoard, when the page refreshes under it", () => {
  it("keeps its order, takes a new photo last, and drops one that has gone", () => {
    const { rerender } = render(board([photo("a"), photo("b"), photo("c")]));
    // The props can lag behind a drop that is still saving: same photos, other order.
    act(() => rerender(board([photo("c"), photo("a"), photo("b")])));
    expect(shown()).toEqual(["a.jpg", "b.jpg", "c.jpg"]);

    act(() => rerender(board([photo("a"), photo("c"), photo("d")])));
    expect(shown()).toEqual(["a.jpg", "c.jpg", "d.jpg"]);
  });
});
