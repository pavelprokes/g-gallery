import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageHeader } from "@/components/ui/page-header";

describe("PageHeader", () => {
  it("renders the title as the page's only h1", () => {
    render(<PageHeader title="Přehled" />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Přehled");
  });

  it("omits the breadcrumb nav and the subtitle when not given", () => {
    render(<PageHeader title="Přehled" />);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("renders crumbs, subtitle and actions when given", () => {
    render(
      <PageHeader
        title="Reportáž"
        crumbs={[{ label: "Přehled", href: "/admin" }, { label: "Reportáž" }]}
        subtitle="12 fotek"
        actions={<button type="button">Publikovat</button>}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Drobečková navigace" })).toBeInTheDocument();
    expect(screen.getByText("12 fotek")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publikovat" })).toBeInTheDocument();
  });
});
