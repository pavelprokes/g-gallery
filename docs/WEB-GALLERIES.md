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

## Suggestions

`/admin/web` offers couples with no web gallery yet, three at a time, newest first. A couple is one
wedding's galleries, or a gallery on its own, with at least 20 own photos and published. There is no
link from a web gallery to its source, because photos are copied, so **the copied files are the
signal**: a couple is covered once any of its photos is in a portfolio gallery, by file identity,
and not a place's, which holds single photos from many weddings. The photos offered are the guests'
highlight pick, at eight, so Lightroom's ratings and pins count. Ceiling: replacing every copied file
breaks the match, and the couple is offered again; the address is then taken, so nothing doubles.
A real link would be a nullable column on the web gallery, if that happens in practice.

"Přidat na web" makes a draft with the ticked photos, at the address given. The address must match a
page in the website's portfolio (Prismic owns those), and a draft shows nothing there. Some galleries
are not for the website; there is nothing to mark them with, so "Další návrhy" pages past them.

## Visit numbers

Beside each published portfolio gallery, `/admin/web` shows the website's own analytics for 90 days:
visits of the album, visits that opened a photo, and views of its photos. The website owns them and
answers `GET /api/photo-stats` with totals by uid, behind `PHOTO_STATS_TOKEN` there and
`WEBSITE_STATS_TOKEN` here (the same value). Without a token, or if it does not answer, the page
simply shows no numbers. **Places have none:** the website's analytics only cover portfolio pages,
and a place's page has only Umami's views, which nothing here can read yet.

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
