import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ViewSparkline } from "./view-sparkline";
import { buildViewSeries, emptySeries, lastDays } from "@/lib/view-series";

const NOW = new Date("2026-08-23T12:00:00Z");
const DAYS = lastDays(NOW, 3);

function series(rows: Array<[string, string]>) {
  const sessions = rows.map(([viewerId, startedAt]) => ({
    galleryId: "g1",
    viewerId,
    startedAt: new Date(startedAt),
  }));
  return buildViewSeries(sessions, DAYS, () => "g1").get("g1") ?? emptySeries(DAYS);
}

describe("ViewSparkline", () => {
  it("says in words what the columns say in colour", () => {
    render(
      <ViewSparkline
        series={series([
          ["v1", "2026-08-23T08:00:00Z"],
          ["v1", "2026-08-23T18:00:00Z"],
          ["v2", "2026-08-23T09:00:00Z"],
        ])}
        max={3}
        label="Anna a Petr"
      />,
    );
    expect(screen.getByRole("img")).toHaveAccessibleName(
      "Anna a Petr: za posledních 14 dní 2 diváci a 1 opakovaná návštěva",
    );
  });

  it("gives every day its own hover label, silent ones included", () => {
    const { container } = render(
      <ViewSparkline series={series([["v1", "2026-08-22T08:00:00Z"]])} max={1} label="Galerie" />,
    );
    const titles = [...container.querySelectorAll("title")].map((node) => node.textContent);
    expect(titles).toEqual([
      "21. 8. — nikdo se nedíval",
      "22. 8. — 1 divák",
      "23. 8. — nikdo se nedíval",
    ]);
  });

  it("keeps a single visit visible next to a much busier day", () => {
    const { container } = render(
      <ViewSparkline
        series={series([
          ["v1", "2026-08-21T08:00:00Z"],
          ...Array.from(
            { length: 40 },
            (_, i) => [`v${i}`, "2026-08-23T08:00:00Z"] as [string, string],
          ),
        ])}
        max={40}
        label="Galerie"
      />,
    );
    // The quiet day is drawn, not rounded away to nothing.
    const paths = container.querySelectorAll("path");
    expect(paths.length).toBeGreaterThanOrEqual(2);
  });

  it("never draws past the plot, even when the minimum heights collide", () => {
    const { container } = render(
      <ViewSparkline
        series={series([
          ["v1", "2026-08-23T08:00:00Z"],
          ["v1", "2026-08-23T09:00:00Z"],
        ])}
        max={2}
        label="Galerie"
      />,
    );
    for (const path of container.querySelectorAll("path")) {
      const d = path.getAttribute("d") ?? "";
      const start = Number(d.match(/^M[\d.]+ ([\d.]+)/)?.[1] ?? 0);
      expect(start).toBeLessThanOrEqual(32);
      expect(start).toBeGreaterThanOrEqual(0);
    }
  });
});
