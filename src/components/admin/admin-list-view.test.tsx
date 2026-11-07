import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AdminListView } from "./admin-list-view";

const shown = () => screen.getByText("seznam").parentElement!.getAttribute("data-view");
const setup = () =>
  render(
    <AdminListView>
      <p>seznam</p>
    </AdminListView>,
  );

beforeEach(() => sessionStorage.clear());

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
});
