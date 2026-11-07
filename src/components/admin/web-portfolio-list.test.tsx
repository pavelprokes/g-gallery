import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/cover-thumb", () => ({ CoverThumb: () => null }));

import type { WebStats } from "@/lib/web-places";
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
const list = (status: string, stats: WebStats | null = null) =>
  render(
    <WebPortfolioList
      galleries={[gallery(status)]}
      websiteBase="https://web.example"
      stats={stats}
    />,
  );

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

  const stats = (uid: string): WebStats => ({
    range: "90",
    indexViews: 40,
    galleries: [{ uid, albumVisits: 12, photoOpens: 5, photoViews: 31 }],
  });

  it("shows the website's numbers beside a page, and nothing without them", () => {
    const { unmount } = list("PUBLISHED", stats("eliska-a-martin-2026"));
    expect(screen.getByText("12 návštěv alba")).toBeInTheDocument();
    expect(screen.getByText(/z toho 5 s otevřenou fotkou/)).toBeInTheDocument();
    expect(screen.getByText(/31 zobrazení fotek za 90 dní/)).toBeInTheDocument();
    expect(screen.getByText(/40 zobrazení za 90 dní/)).toBeInTheDocument();
    unmount();

    list("PUBLISHED");
    expect(screen.queryByText(/90 dní/)).toBeNull();
  });

  it("does not pass a page missing from the numbers off as zeros", () => {
    list("PUBLISHED", stats("jina-adresa"));
    expect(screen.getByText(/bez návštěv, nebo se adresa liší/)).toBeInTheDocument();
    expect(screen.queryByText(/návštěv alba/)).toBeNull();
  });

  it("shows no numbers on a draft", () => {
    list("DRAFT", stats("eliska-a-martin-2026"));
    expect(screen.queryByText(/návštěv alba|bez návštěv/)).toBeNull();
  });
});
