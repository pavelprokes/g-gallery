import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These controls carry no copy of their own beyond an aria-label; echoing the
// key keeps the tests about behaviour rather than about wording.
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/image", () => ({
  default: (props: { src: string; onLoad?: () => void; onError?: () => void }) => (
    // A tile only needs something that paints in jsdom; next/image needs a loader.
    // eslint-disable-next-line @next/next/no-img-element
    <img alt="" src={props.src} onLoad={props.onLoad} onError={props.onError} />
  ),
}));

import { HeartButton, PhotoTile, PrinterButton } from "@/components/gallery-view";
import type { GalleryPhoto } from "@/components/gallery-view";
import { createScreenGate, type ScreenGate } from "@/lib/screen-gate";

/**
 * Whether a tile's heart or printer is reachable on a phone is decided purely
 * by these class strings — `pointer-coarse:hidden` is what keeps an idle
 * control from sitting invisibly over every photo in the gallery, and dropping
 * it is the regression that made the grid noisy in the first place. There is
 * no layout to assert against in jsdom, so the classes are the behaviour.
 */
const hiddenOnTouch = (el: HTMLElement) =>
  el.className.split(/\s+/).includes("pointer-coarse:hidden");

describe("HeartButton on a tile", () => {
  const noop = () => {};

  it("is not rendered on touch while idle", () => {
    render(<HeartButton active={false} count={0} onClick={noop} />);
    expect(hiddenOnTouch(screen.getByRole("button"))).toBe(true);
  });

  it("stays visible once this viewer has hearted the photo", () => {
    render(<HeartButton active count={1} onClick={noop} />);
    const button = screen.getByRole("button");
    expect(hiddenOnTouch(button)).toBe(false);
    expect(button.className).toContain("opacity-100");
  });

  // A photo somebody else has hearted carries a count worth reading. This
  // pinned on `active` alone before, so on touch the tile showed nothing.
  it("stays visible for somebody else's count, before this viewer joins in", () => {
    render(<HeartButton active={false} count={3} onClick={noop} />);
    expect(hiddenOnTouch(screen.getByRole("button"))).toBe(false);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("is pinned onto the tile in marking mode", () => {
    render(<HeartButton active={false} count={0} onClick={noop} pinned />);
    const button = screen.getByRole("button");
    expect(hiddenOnTouch(button)).toBe(false);
    expect(button.className).toContain("opacity-100");
  });

  // The lightbox's bar supplies its own background and is never hover-gated.
  it("is always visible in the lightbox", () => {
    render(<HeartButton active={false} count={0} onClick={noop} size="lg" bare />);
    expect(hiddenOnTouch(screen.getByRole("button"))).toBe(false);
  });
});

describe("PrinterButton on a tile", () => {
  const noop = () => {};

  it("is not rendered on touch while no copies are marked", () => {
    render(<PrinterButton quantity={0} onIncrement={noop} onDecrement={noop} />);
    expect(hiddenOnTouch(screen.getByRole("button"))).toBe(true);
  });

  it("is pinned onto the tile in marking mode", () => {
    render(<PrinterButton quantity={0} onIncrement={noop} onDecrement={noop} pinned />);
    const button = screen.getByRole("button");
    expect(hiddenOnTouch(button)).toBe(false);
    expect(button.className).toContain("opacity-100");
  });

  // A marked quantity is information, so the stepper shows on touch whether or
  // not marking mode is on.
  it("shows its stepper once a quantity is set, with marking mode off", () => {
    render(<PrinterButton quantity={2} onIncrement={noop} onDecrement={noop} />);
    expect(screen.getByRole("group")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  // Copies somebody else marked are what a returning viewer (or the partner
  // on another phone) needs to see — same rule as the heart's count above.
  it("stays visible for somebody else's copies, before this viewer marks any", () => {
    render(<PrinterButton quantity={0} others={3} onIncrement={noop} onDecrement={noop} />);
    const button = screen.getByRole("button");
    expect(hiddenOnTouch(button)).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("markForPrintOthers");
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("keeps somebody else's copies apart from this viewer's own", () => {
    render(<PrinterButton quantity={1} others={2} onIncrement={noop} onDecrement={noop} />);
    expect(screen.getByText("(+2)")).toBeTruthy();
  });
});

describe("a long press on a tile", () => {
  const photo: GalleryPhoto = {
    id: "photo_1",
    objectKey: "g/1/a.jpg",
    thumbObjectKey: null,
    video: null,
    fileName: "DSC_1234.jpg",
    width: 3000,
    height: 2000,
    placeholder: null,
    favoriteCount: 0,
    uploaderName: null,
    orderKey: "2026-09-19T14:00:00.000Z",
    faces: null,
    focus: null,
  };

  const renderTile = (onPick: (index: number, id: string, shift: boolean) => void) => {
    render(
      <PhotoTile
        photo={photo}
        src="a.jpg"
        fallbackSrc="a.jpg"
        width={170}
        height={120}
        index={0}
        priority={false}
        tabbable
        selectionActive={false}
        selected={false}
        allowDownload
        allowReactions
        allowPrintSelection
        markingMode
        isFavorite={false}
        favoritePulse={false}
        favoriteCount={0}
        reactionState={undefined}
        printQuantity={0}
        onPick={onPick}
        onOpen={() => {}}
        onToggleFavorite={() => {}}
        onIncrementPrint={() => {}}
        onDecrementPrint={() => {}}
        onFocus={() => {}}
        registerTileRef={() => {}}
      />,
    );
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts the download selection when the press is on the photo", () => {
    const onPick = vi.fn();
    renderTile(onPick);
    fireEvent.touchStart(screen.getByLabelText("openPhoto"));
    vi.advanceTimersByTime(600);
    expect(onPick).toHaveBeenCalledWith(0, "photo_1", false);
  });

  // The heart, the printer and the checkbox sit over the tile's button but are
  // still children of the same div, so their touchstart bubbles to its
  // handler. Holding the heart used to favourite the photo *and* drop the
  // viewer into the download selection — and marking mode puts a heart on
  // every tile in the gallery.
  it.each(["addToFavorites", "markForPrint", "selectPhoto"])(
    "leaves it alone when the press is on the %s control",
    (label) => {
      const onPick = vi.fn();
      renderTile(onPick);
      fireEvent.touchStart(screen.getByLabelText(label));
      vi.advanceTimersByTime(600);
      expect(onPick).not.toHaveBeenCalled();
    },
  );
});

describe("PhotoTile and the screen gate", () => {
  const photo: GalleryPhoto = {
    id: "photo_2",
    objectKey: "galleries/x/b.jpg",
    thumbObjectKey: null,
    video: null,
    fileName: "DSC_2.jpg",
    width: 3000,
    height: 2000,
    placeholder: null,
    favoriteCount: 0,
    uploaderName: null,
    orderKey: "2026-09-19T14:00:00.000Z",
    faces: null,
    focus: null,
  };
  const tile = (gate: ScreenGate, onScreen: boolean, screenClear: boolean) => (
    <PhotoTile
      photo={photo}
      // No browser-made thumbnail: the tile and its fallback are one image.
      src="b.jpg"
      fallbackSrc="b.jpg"
      width={170}
      height={120}
      index={0}
      priority={false}
      onScreen={onScreen}
      screenGate={gate}
      screenClear={screenClear}
      tabbable
      selectionActive={false}
      selected={false}
      allowDownload={false}
      allowReactions={false}
      allowPrintSelection={false}
      markingMode={false}
      isFavorite={false}
      favoritePulse={false}
      favoriteCount={0}
      reactionState={undefined}
      printQuantity={0}
      onPick={() => {}}
      onOpen={() => {}}
      onToggleFavorite={() => {}}
      onIncrementPrint={() => {}}
      onDecrementPrint={() => {}}
      onFocus={() => {}}
      registerTileRef={() => {}}
    />
  );

  it("on screen, holds the gate until its image fails for good — once, with no thumbnail", () => {
    const gate = createScreenGate();
    const { container } = render(tile(gate, true, false));
    gate.open();
    expect(gate.isClear()).toBe(false);
    // The same image is all there is to fall back to: one error is final.
    fireEvent.error(container.querySelector("img")!);
    expect(gate.isClear()).toBe(true);
  });

  it("on screen, lets the gate go after a while if its image never answers", () => {
    vi.useFakeTimers();
    const gate = createScreenGate();
    render(tile(gate, true, false));
    gate.open();
    vi.advanceTimersByTime(15_000);
    expect(gate.isClear()).toBe(true);
    vi.useRealTimers();
  });

  it("off screen, fetches only while the gate is clear, and keeps what has drawn", () => {
    const gate = createScreenGate();
    const { container, rerender } = render(tile(gate, false, false));
    expect(container.querySelector("img")).toBeNull();
    rerender(tile(gate, false, true));
    expect(container.querySelector("img")).not.toBeNull();
    // The next row coming on screen shuts the gate: a download not yet drawn goes…
    rerender(tile(gate, false, false));
    expect(container.querySelector("img")).toBeNull();
    // …one that has drawn stays.
    rerender(tile(gate, false, true));
    fireEvent.load(container.querySelector("img")!);
    rerender(tile(gate, false, false));
    expect(container.querySelector("img")).not.toBeNull();
  });
});
