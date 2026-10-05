import { describe, expect, it } from "vitest";
import { BUSINESS_ID, PERSON_ID, landingJsonLd } from "./landing-jsonld";

const faq = [{ q: "Where do I get the link?", a: "From the photographer." }];

function graph(locale: "cs" | "en" | "fr" = "cs") {
  return landingJsonLd({ locale, title: "Title", description: "Description", faq })["@graph"];
}

function node(type: string) {
  return graph().find((n) => n["@type"] === type) as Record<string, unknown>;
}

describe("landingJsonLd", () => {
  it("keeps the FAQ as the page's main entity", () => {
    expect(node("FAQPage").mainEntity).toEqual([
      {
        "@type": "Question",
        name: "Where do I get the link?",
        acceptedAnswer: { "@type": "Answer", text: "From the photographer." },
      },
    ]);
  });

  it("states the page's language as a full tag", () => {
    const page = (locale: "cs" | "fr") =>
      graph(locale).find((n) => n["@type"] === "FAQPage") as Record<string, unknown>;
    expect(page("cs").inLanguage).toBe("cs-CZ");
    expect(page("fr").inLanguage).toBe("fr-FR");
  });

  // The main site owns these ids; a typo here would quietly create a second,
  // fact-less entity instead of pointing at the real one.
  it("points publisher and author at the main site's entities", () => {
    expect(BUSINESS_ID).toBe("https://svatebni-fotograf-cechy.cz/#organization");
    expect(PERSON_ID).toBe("https://svatebni-fotograf-cechy.cz/#person");
    expect(node("FAQPage").publisher).toEqual({ "@id": BUSINESS_ID });
    expect(node("FAQPage").author).toEqual({ "@id": PERSON_ID });
    expect(node("ProfessionalService")["@id"]).toBe(BUSINESS_ID);
    expect(node("Person")["@id"]).toBe(PERSON_ID);
  });

  it("matches the canonical URL of /", () => {
    expect(node("FAQPage").url).toBe("https://photos.svatebni-fotograf-cechy.cz");
  });

  // Facts (address, phone, prices) are kept on the main site only, so the two
  // properties can never state different ones.
  it("does not duplicate the business's facts", () => {
    expect(Object.keys(node("ProfessionalService")).sort()).toEqual(
      ["@id", "@type", "founder", "name", "url"].sort(),
    );
  });
});
