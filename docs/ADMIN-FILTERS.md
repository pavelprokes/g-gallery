# Admin gallery filters

Adopted 2026-10-19 (Pavel: "filtry pro tisk, připomínky, označené lidi, vybrané do videa… do URL a
zpět"). Authority for the filter bar above the photo grid in `/admin/g/[id]`.

## In the URL, always

Every choice is a query parameter, so a view is bookmarked, shared, reloaded and undone with the
browser's Back. Chips are plain links; the person and chapter selects and the search push a URL.
`src/lib/admin-photo-filters.ts` parses and writes it — unknown values are dropped, never refused,
and the links from before (`?print=1`, `?timeline=1`) still work.

| Parameter | Values                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `f`       | comma list, all must hold: `comments` (open corrections, docs/CORRECTIONS.md), `print`, `favorites`, `reactions`, `viewed`, `highlights`, `video-draft`, `tagged`, `untagged`, `guests`, `videos` |
| `person`  | a `GalleryPerson` id — photos with them named (docs/SOCIAL-VIDEO.md §4)                                                                                                                           |
| `chapter` | a chapter id — its photos as the guests' grid places them (docs/CHAPTERS.md)                                                                                                                      |
| `q`       | part of the file name — a camera number (`PPR55013`) is enough                                                                                                                                    |
| `sort`    | `loved` (default), `views`, `viewers`, `order` (the guests' order with chapter headings), `name`                                                                                                  |

Each chip shows how many photos it would leave on top of the rest of the view; a chip that would
leave none is hidden unless it is on. `tagged` and `untagged` exclude each other.

## Where the facts come from

All computed by the page per request, no new queries per photo: favourites (`_count`), reactions
and print totals (existing grouped queries), views and unique viewers (`photoCounts`), the
highlights exactly as guests get them (`pickHighlights`), face tags, source, video, the chapter
from the same grouping the timeline uses.

**"Ve videu pro sítě"** reads `Gallery.socialVideoDraft` — the studio's draft now also lives on the
gallery (saved a second after the last change, `saveSocialVideoDraft`), not only in the browser's
localStorage, so the filter can see it and another device continues the draft.

## Later

A "replaced" filter (photos swapped for a corrected export) would join the same list.
