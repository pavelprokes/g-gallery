import { describe, expect, it } from "vitest";
import { parseClock, playerCommand, youtubeEmbedUrl, youtubeId } from "@/lib/reels/youtube";

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

  it("embeds the privacy-enhanced player with its API on", () => {
    const url = new URL(youtubeEmbedUrl("7dQUq5w9-Gw", "https://photos.test"));
    expect(url.origin + url.pathname).toBe("https://www.youtube-nocookie.com/embed/7dQUq5w9-Gw");
    expect(url.searchParams.get("enablejsapi")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("https://photos.test");
  });
});

describe("the player's API", () => {
  it("speaks the IFrame API's message format", () => {
    expect(JSON.parse(playerCommand("seekTo", [83, true]))).toEqual({
      event: "command",
      func: "seekTo",
      args: [83, true],
    });
  });
});

describe("parseClock", () => {
  it.each([
    ["1:23", 83],
    ["0:05", 5],
    ["83", 83],
    [" 2:00 ", 120],
  ])("reads %s", (input, seconds) => expect(parseClock(input)).toBe(seconds));
  it.each(["", "1:75", "a:10", "-3", "1:2:3"])("refuses %s", (input) =>
    expect(parseClock(input)).toBeNull(),
  );
});
