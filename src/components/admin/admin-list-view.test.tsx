import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminListView } from "./admin-list-view";

const shown = () => screen.getByText("seznam").parentElement!.getAttribute("data-view");
const setup = () =>
  render(
    <AdminListView>
      <p>seznam</p>
    </AdminListView>,
  );

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("AdminListView", () => {
  it("opens on tiles", () => {
    setup();
    expect(shown()).toBe("tiles");
    expect(screen.getByRole("button", { name: "Dlaždice" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches, and keeps the choice for the session", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Řádky" }));
    expect(shown()).toBe("rows");
    expect(screen.getByRole("button", { name: "Řádky" })).toHaveAttribute("aria-pressed", "true");

    cleanup();
    setup();
    expect(shown()).toBe("rows");

    fireEvent.click(screen.getByRole("button", { name: "Dlaždice" }));
    expect(shown()).toBe("tiles");
  });

  it("still switches where storage is blocked", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Řádky" }));
    expect(shown()).toBe("rows");
    fireEvent.click(screen.getByRole("button", { name: "Dlaždice" }));
    expect(shown()).toBe("tiles");
  });
});
