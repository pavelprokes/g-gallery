# Web galleries

The wedding website (svatebni-fotograf-cechy.cz) reads its portfolio photos from here. Words stay
in the website's CMS; this repo owns the photos, their order and the cover.

- **A web gallery is an ordinary gallery with `Gallery.webSlug`**, equal to the portfolio uid on
  the website. It is that uid's single source: `webSlug` is unique.
- **Live means `PUBLISHED`.** A draft, or a slug removed again, answers 404 and the website falls
  back to its previous source for that gallery alone.
- **Photos are copied, not referenced** (`copyPhotosToWebGalleryFor`). The couple's gallery can be
  deleted without touching the website, and no client storage prefix appears on it.
- **The selection copies four photos at a time**, a Server Action each, so the bar can count them.
  A failure keeps the selection: copying again skips what has landed, by file identity.
- **A web gallery cannot be trashed** while it has a slug (`trashGallery`). Remove the slug first.
- **Its originals still age into Infrequent Access** after 180 days: the bucket rule covers all of
  `galleries/`, and the lifecycle pass only records it. A CDN miss then pays the IA read, on about
  12 MB a photo, and every cached transformation does not.

## Places

The same mechanism fills fixed places on the website: the homepage, the pricing pages, the shared
page templates. A place's key is a `webSlug` starting with `misto-`, one gallery per place. The
website owns the list and serves it at `/api/photo-places`; `/admin/web` reads it, so a new place
needs no change here.

Position decides what a photo does, and `coverFirst` gives the cover the first position: the
homepage hero is the gallery's cover. A position with no usable photo, or with a portrait where only
landscape works, keeps the website's old photo. `/admin/web` warns about both.

## API

`GET /api/web/galleries` and `GET /api/web/galleries/{slug}`, with
`Authorization: Bearer $WEB_API_SECRET`. Without `WEB_API_SECRET` both answer 404, so a deployment
that has not opted in behaves as before.

A slug outside the pattern answers 404 too: it can never be a web gallery, and the website treats
anything but 404 as an outage. Only `CONFIRMED`, `OWNER`, non-video photos, and only the fields in `PUBLIC_PHOTO_SELECT`: no faces,
no viewer data. `takenAt` is UTC, while the website's chapters are local "HH:MM", so the reader must
convert it (`Europe/Prague`, the zone the upload browser read the EXIF time in).

Image bytes never pass through here: the website builds CDN URLs from `objectKey` with the same
widths as `src/lib/image-sizes.ts`, so it shares this repo's transformations and their allowance.
