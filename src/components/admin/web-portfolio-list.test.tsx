import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/cover-thumb", () => ({ CoverThumb: () => null }));

import { WebPortfolioList } from "./web-portfolio-list";

const gallery = (status: string) => ({
  id: "g1",
  title: "Web: Eliška a Martin",
  status,
  webSlug: "eliska-a-martin-2026",
  coverPhoto: null,
  photos: [],
  _count: { photos: 12 },
});
const list = (status: string) =>
  render(<WebPortfolioList galleries={[gallery(status)]} websiteBase="https://web.example" />);

describe("WebPortfolioList", () => {
  it("links a published gallery's title and a button to its page, the gallery as main", () => {
    list("PUBLISHED");
    const page = "https://web.example/portfolio/eliska-a-martin-2026";
    expect(screen.getByRole("link", { name: /Na webu/ })).toHaveAttribute("href", page);
    expect(screen.getByRole("link", { name: "Web: Eliška a Martin" })).toHaveAttribute(
      "href",
      page,
    );
    expect(screen.getByRole("link", { name: "Otevřít galerii" })).toHaveAttribute(
      "href",
      "/admin/g/g1",
    );
  });

  it("does not send a draft to a page that may not exist", () => {
    list("DRAFT");
    expect(screen.queryByRole("link", { name: /Na webu/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Web: Eliška a Martin" })).toBeNull();
    expect(screen.getByText("Koncept")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Otevřít galerii" })).toBeInTheDocument();
  });
});
