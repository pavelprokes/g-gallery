# Photo links — the open photo in the address

Adopted 2026-10-20 on Pavel's ask: while a viewer browses the lightbox, the address bar names the
photo on screen, so it can be copied and sent ("look at this one").

## The address

`…/g/{token}/{slug}?foto={photoId}` (also under a wedding page, `/s/{token}/{key}?foto=…`).

- Only the photo id is added. Access still resolves by the share token alone (CLAUDE.md
  invariant 5); an id grants nothing, and one from another gallery simply finds nothing.
- A query parameter, not a hash: the hash already belongs to chapters (docs/CHAPTERS.md §Links),
  and the server has to see the parameter to give the link its own preview.
- `src/lib/photo-link.ts` reads and writes it; anything not shaped like an id is ignored.

## While browsing

- Opening the lightbox still pushes **one** history entry (Back closes it). The parameter is
  written into that entry and _replaced_ as the viewer moves to the next photo — never pushed, so
  one Back closes the lightbox wherever they browsed to, and lands on the gallery without a photo.
- Replaced with a fresh state object, which Next's patched History API syncs the router to (the
  same reason `replaceHash` passes `null`).
- Forward onto a closed lightbox's entry takes the parameter off rather than naming a photo that
  is not on screen.

## Opening a link

- Same mechanics as a highlight's jump (docs/HIGHLIGHTS.md): pages are pulled until the photo is in
  the grid, one **instant** scroll puts its row in view (so closing lands there), then the lightbox
  opens on it — counted as a photo view like any open.
- The parameter comes off the gallery's own entry first, so Back from the photo is the gallery.
- A photo that is gone (deleted, never here) opens nothing and the parameter is removed, so a dead
  link is not passed on.

## Link preview

`generateMetadata` previews a photo link with **that photo** (og:image, and og:url carrying the
parameter) when it is a `CONFIRMED` photo of the link's own gallery; anything else falls back to
the gallery's cover. A video row previews with its poster (`objectKey`, docs/VIDEO.md).

## Analytics

The query never reaches analytics (CLAUDE.md invariant 7): Umami's `umamiScrub` drops it and the
script runs with `data-exclude-search`, without which every photo browsed counted as a pageview.
Vercel Analytics tracks the pathname only.
