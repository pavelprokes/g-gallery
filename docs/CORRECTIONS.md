# Corrections mode — the couple asks for retouches

Adopted 2026-10-19 (Pavel: "kdo bude mít 6místný PIN, pár nebo klient, bude moci okomentovat fotku
a říct, že chce nějakou korekturu, jinak komentáře nepovolovat… při každém vstupu do toho módu to
bude chtít PIN"). Authority for `PhotoComment`, the PIN on `ShareLink`, `api/g/[token]/corrections`
and the guest and admin UI around them.

## Who can do what

- **Per link, off by default.** `ShareLink.allowCorrections`, set in the admin's share-link panel
  ("Připomínky (PIN)"; the "Předání fotek" preset ticks it). Switching it on the first time gives
  the link a 6-digit PIN; "Nový PIN" replaces it and ends every open session.
- **Never through a wedding page.** A gallery opened via the hub's composite token
  (`eventToken~eventKey`) never offers the mode — every guest can open those cards
  (`resolveShareLink` clears the flag).
- **PIN every time.** Entering returns a session key (`src/lib/correction-session.ts`): HMAC over
  link, PIN hash and expiry (2 h), kept in the page's memory only — never a cookie — so a reload, a
  closed tab or "Ukončit" asks again. A new PIN changes the hash, so old keys die.
- **The couple** (anyone with link + PIN) writes, edits and deletes comments, optionally with a
  spot (`x`, `y`, 0–1 of the photo). A comment the photographer resolved is read-only for them.
- **Guests** on any other link, or without the PIN, see nothing; the API answers 403/401.

## Brute force and nuisance

The PIN is stored twice: scrypt hash (verification, like the password) and AES cipher (display in
the admin, like `tokenCipher`). An attempt is reserved under a row lock _before_ the scrypt check,
so parallel guesses each count. Ten wrong PINs lock the link's PIN entry for five minutes; a lockout
that has run out starts the count afresh. 10⁶ PINs at ten per five minutes is years of guessing,
while someone who merely holds the link can delay the couple by minutes, not lock them out.

## The guest UI (`src/components/corrections/`)

- Toolbar "Připomínky" (pencil, labelled) → PIN sheet (numeric keypad, paste, one-time-code).
- While on: a sticky bar ("Režim připomínek · 3 fotky s připomínkou · Ukončit"), a pencil badge
  with the count on tiles, and in the lightbox a panel — beside the photo on a desktop, a sheet on
  the lower 45 % on a phone; the photo and its controls move out of its way. "Označit místo" + a tap
  drops a numbered spot inside the zoomed frame, so it follows a pinch. Films get words only.
- Copy in all seven catalogs (`corrections` namespace); the client guide's chapter 5.

## The admin

- Filter `f=comments` (open corrections, docs/ADMIN-FILTERS.md) and a header button
  "Připomínky (N)" while any are open.
- Under each tile: the comments, numbered, each "Označit vyřízené" / back; the whole photo at its own
  shape with the spots on it. "Čísla pro Lightroom" copies the camera numbers; "Připomínky jako
  text" copies `file: comment` lines.
- **Replacing the photo with a corrected export resolves its open comments**
  (`replacePhotoBytes`, docs/REPLACE-PHOTOS.md) — the couple reads "Opraveno ✓" on the new file.
- Activity `CORRECTION` per comment; one push per quiet quarter-hour, not one per comment.

## Not done

A comment thread with the photographer's replies; a limit of free retouches; showing the couple
which of their comments the photographer has read.
