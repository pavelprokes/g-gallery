import { describe, expect, it } from "vitest";
import { parseXmpPicks, readXmpPicksFromJpeg } from "@/lib/xmp-picks";

// The shape Lightroom Classic writes into an exported JPEG: simple properties
// as attributes on rdf:Description, keywords as an rdf:Bag.
const LIGHTROOM_PACKET = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmp:Rating="5"
   xmp:Label="Green">
   <dc:subject>
    <rdf:Bag>
     <rdf:li>svatba</rdf:li>
     <rdf:li>Výběr</rdf:li>
    </rdf:Bag>
   </dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

/** A JPEG prefix: SOI, then the given APP1 payloads, then start of scan. */
function jpegWith(...app1: Uint8Array[]): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (const payload of app1) {
    const length = payload.length + 2;
    parts.push(0xff, 0xe1, length >> 8, length & 0xff, ...payload);
  }
  parts.push(0xff, 0xda, 0x00, 0x02);
  return new Uint8Array(parts);
}

const bytes = (text: string) => new TextEncoder().encode(text);

describe("parseXmpPicks", () => {
  it("reads Lightroom's rating, label and keywords", () => {
    expect(parseXmpPicks(LIGHTROOM_PACKET)).toEqual({ rating: 5, label: "Green", tagged: true });
  });

  it("reads the element form other writers use", () => {
    const packet =
      "<xmp:Rating>3</xmp:Rating><xmp:Label>Red</xmp:Label>" +
      "<dc:subject><rdf:Bag><rdf:li>Highlight</rdf:li></rdf:Bag></dc:subject>";
    expect(parseXmpPicks(packet)).toEqual({ rating: 3, label: "Red", tagged: true });
  });

  it("does not take an ordinary keyword for a pick", () => {
    const packet = `<dc:subject><rdf:Bag><rdf:li>best man</rdf:li><rdf:li>top</rdf:li></rdf:Bag></dc:subject>`;
    expect(parseXmpPicks(packet).tagged).toBe(false);
  });

  it("keeps a rejected photo's -1 and clamps nonsense", () => {
    expect(parseXmpPicks(`xmp:Rating="-1"`).rating).toBe(-1);
    expect(parseXmpPicks(`xmp:Rating="9"`).rating).toBe(5);
    expect(parseXmpPicks(`xmp:Rating="x"`).rating).toBeNull();
  });

  it("is empty for a packet without marks", () => {
    expect(parseXmpPicks("<x:xmpmeta/>")).toEqual({ rating: null, label: null, tagged: false });
  });
});

describe("readXmpPicksFromJpeg", () => {
  it("finds the XMP segment behind an EXIF one", () => {
    const exif = bytes("Exif\0\0MM\0*\0\0\0\x08");
    const xmp = bytes(`http://ns.adobe.com/xap/1.0/\0${LIGHTROOM_PACKET}`);
    expect(readXmpPicksFromJpeg(jpegWith(exif, xmp))).toEqual({
      rating: 5,
      label: "Green",
      tagged: true,
    });
  });

  it("is null without XMP, and for something that is not a JPEG", () => {
    expect(readXmpPicksFromJpeg(jpegWith(bytes("Exif\0\0")))).toBeNull();
    expect(readXmpPicksFromJpeg(bytes("GIF89a"))).toBeNull();
  });

  it("stops at a truncated segment instead of reading past the prefix", () => {
    const xmp = jpegWith(bytes(`http://ns.adobe.com/xap/1.0/\0${LIGHTROOM_PACKET}`));
    expect(readXmpPicksFromJpeg(xmp.subarray(0, 40))).toBeNull();
  });
});
