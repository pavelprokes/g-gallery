# Engraving plate

Built 2026-10-27 on Pavel's request. The photographer engraves a plate for each couple (the bottom of
the photo box): his leaf frame, the couple's names and the wedding date. Until now that meant
opening `TM_2025_12x-100.af` in Affinity, retyping the names and exporting. The admin now does it:
**Gravírování** on a wedding (`/admin/e/[id]/engraving`) and on a gallery
(`/admin/g/[id]/engraving`).

## What it produces

- **SVG (křivky)** — the default and what the laser wants. Text converted to outlines in the
  browser (opentype.js), so the file engraves the same on a machine without the font. No
  background rectangle: an engraving program would burn it as a filled shape. Three paths with
  ids `ramecek`, `jmena`, `datum`.
- **JPG** — the outlined plate on white, 1296 × 1193 px with 144 dpi written into the JFIF header
  (a canvas encodes no density, which programs read as 72 dpi, i.e. double the physical size).
- **SVG s textem** — live `<text>` at the same positions, for editing in Affinity. Needs the font
  installed; the page links the TTF.

All three are cropped **edge to edge** (Pavel, 2026-10-28: no white around the drawing): the plate is the
template canvas cut to the frame's ink — the lines' ends left and right, the top and bottom leaf
tips above and below. The drawing keeps the template's scale, only the empty margin goes. Text
always shrinks to fit between the lines, so the crop is the same for every wedding and nothing is
ever cut off.

Nothing is uploaded or stored. The page is a pure client-side tool over static files, so the
invariants about image bytes do not come into it.

## The template

Everything is measured from Pavel's Affinity file, not eyeballed:

- **Canvas** 1702 × 1815 px at 144 dpi — the size of the JPEG embedded in the `.af` file. The
  plate is its crop at (203, 312), 1296 × 1193; every measurement below is on the template canvas
  and `plate.ts` shifts it by that corner.
- **Frame** — in the `.af` file the leaves are not vectors but that embedded JPEG (an older
  plate, "TERKA & MATĚJ", with the text covered). There is no vector original in reach
  (`logo_v2.ai` lives on Pavel's Mac), so `public/vendor/engraving/leaf-frame.svg` was traced
  from it with potrace: text band blanked, 4× Lanczos upscale, 3 px blur, threshold, the two
  lines repainted as exact rectangles (x 203–1498, y 753–763 and 1188–1198) so their corners stay
  square, `potrace --turdsize 40 --alphamax 1.1 --opttolerance 0.4`, transform and crop baked
  into the plate's own coordinates at 0.1 px (a `viewBox` starting at 0 0 — some laser programs
  mis-place a shifted one). 41 kB, one path, 1.3 % of the ink pixels differ from the source
  at 1×, all on edges.
- **Text** — Playfair Display Medium (the font named in the `.af` file). Names 128 px on a
  baseline at y = 958, date 76 px on y = 1098, each centred on its ink at x = 851. The unit test
  checks the generator against Pavel's own export of "Alice a Martin, 22. 8. 2026" to within
  4 px.

## Fonts

Static instances from Google Fonts with their OFL licences, in `public/vendor/engraving/fonts/`
(no third-party request from the admin): Playfair Display 500 (the template), Cormorant Garamond
600, Lora 500, Bitter 500 (the main site's face), Cinzel 500 and Great Vibes 400. Other faces keep
the template's cap height, figure height and gap, so the block sits in the same place; Great Vibes
gets an optical ×1.45 and sets its date in Playfair (script figures engrave badly). Every face is
tested for the Czech alphabet and for staying between the lines.

Adding a face: download the static TTF (`fonts.googleapis.com/css2?family=…:wght@…` with a
non-browser user agent returns a TTF URL), commit it with its `OFL.txt`, add it to
`src/lib/engraving/fonts.ts`. The plate test then covers it.

## Layout rules

- Names are one line: first name, joiner (`a` or `&`, taken from the title), second name.
  Prefilled from the wedding's title; a gallery prefers its wedding's title and drops anything
  after a comma ("Alice a Martin, Zámek Úsobí, 1. set").
- Names wider than 1180 px shrink to fit; the photographer can scale them 70–120 %.
- All-caps sets the names at 0.84× (the cap height of his earlier "TERKA & MATĚJ" plate).
- An empty date or names field leaves that line out and centres the other.
