import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";

const TRAIL = [
  { label: "Přehled", href: "/admin" },
  { label: "Anna a Petr", href: "/admin/e/evt1" },
  { label: "Reportáž" },
];

describe("Breadcrumbs", () => {
  it("renders nothing when there is no trail", () => {
    const { container } = render(<Breadcrumbs items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marks the current page and does not link it", () => {
    render(<Breadcrumbs items={TRAIL} />);

    const current = screen.getByText("Reportáž");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Reportáž" })).toBeNull();
  });

  it("links every ancestor", () => {
    render(<Breadcrumbs items={TRAIL} />);

    expect(screen.getByRole("link", { name: "Přehled" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("link", { name: "Anna a Petr" })).toHaveAttribute(
      "href",
      "/admin/e/evt1",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("hides the separators from assistive tech", () => {
    render(<Breadcrumbs items={TRAIL} />);

    // A screen reader reading "Přehled slash Anna a Petr slash Reportáž" is noise;
    // the list structure already carries the hierarchy.
    const nav = screen.getByRole("navigation", { name: "Drobečková navigace" });
    expect(nav.querySelectorAll("[aria-hidden]")).toHaveLength(2);
  });
});
