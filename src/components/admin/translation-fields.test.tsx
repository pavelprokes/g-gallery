import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readTranslationsFromForm } from "@/lib/content-translations";
import { TranslationFields } from "./translation-fields";

/**
 * The admin form and the server action agree on field names only by
 * convention (`translationFieldName`). This renders the real inputs inside a
 * real <form>, reads them back with the exact function the actions use, and so
 * catches any drift between the two.
 */
describe("TranslationFields", () => {
  const fields = [
    { name: "title" as const, label: "Název", maxLength: 200, original: "Obřad" },
    { name: "venue" as const, label: "Místo", maxLength: 200, original: null },
  ];

  it("round-trips through the same reader the server action uses", () => {
    const { container } = render(
      <form>
        <TranslationFields
          fields={fields}
          values={{ en: { title: "Ceremony", venue: "Benice Farm" }, fr: { title: "Cérémonie" } }}
        />
      </form>,
    );
    const form = container.querySelector("form")!;
    expect(readTranslationsFromForm(new FormData(form), { title: 200, venue: 200 })).toEqual({
      success: true,
      data: { en: { title: "Ceremony", venue: "Benice Farm" }, fr: { title: "Cérémonie" } },
    });
  });

  it("stays collapsed while nothing is translated, and opens once something is", () => {
    const { container, rerender } = render(<TranslationFields fields={fields} />);
    expect(container.querySelector("details")).not.toHaveAttribute("open");

    rerender(<TranslationFields fields={fields} values={{ fr: { title: "Cérémonie" } }} />);
    expect(container.querySelector("details")).toHaveAttribute("open");
  });

  it("shows the Czech original as the placeholder, and marks each group's language", () => {
    const { container } = render(<TranslationFields fields={fields} />);
    expect(screen.getAllByPlaceholderText("Obřad")).toHaveLength(2);
    expect(container.querySelector('fieldset[lang="en"]')).not.toBeNull();
    expect(container.querySelector('fieldset[lang="fr"]')).not.toBeNull();
  });
});
