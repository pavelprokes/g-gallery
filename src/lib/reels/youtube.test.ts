import { describe, expect, it } from "vitest";
import { youtubeEmbedUrl, youtubeId } from "@/lib/reels/youtube";

describe("youtubeId", () => {
  it.each([
    ["https://youtu.be/7dQUq5w9-Gw?is=fwD-dWPxFRO5r_jJ", "7dQUq5w9-Gw"],
    ["https://www.youtube.com/watch?v=7dQUq5w9-Gw&t=42s", "7dQUq5w9-Gw"],
    ["https://m.youtube.com/watch?v=7dQUq5w9-Gw", "7dQUq5w9-Gw"],
    ["https://music.youtube.com/watch?v=7dQUq5w9-Gw", "7dQUq5w9-Gw"],
    ["https://youtube.com/shorts/7dQUq5w9-Gw", "7dQUq5w9-Gw"],
    ["https://www.youtube.com/embed/7dQUq5w9-Gw", "7dQUq5w9-Gw"],
    ["  https://youtu.be/7dQUq5w9-Gw  ", "7dQUq5w9-Gw"],
  ])("reads %s", (input, id) => expect(youtubeId(input)).toBe(id));

  it.each([
    "7dQUq5w9-Gw",
    "https://vimeo.com/123",
    "https://youtube.com.evil.example/watch?v=7dQUq5w9-Gw",
    "https://www.youtube.com/watch?v=short",
    "https://youtu.be/7dQUq5w9-Gw%22onload",
  ])("refuses %s", (input) => expect(youtubeId(input)).toBeNull());

  it("embeds the privacy-enhanced player", () => {
    expect(youtubeEmbedUrl("7dQUq5w9-Gw")).toBe(
      "https://www.youtube-nocookie.com/embed/7dQUq5w9-Gw?rel=0",
    );
  });
});
