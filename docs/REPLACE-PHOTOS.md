# Replacing photos with a corrected export

Adopted 2026-10-19. A couple asks for a few retouched photos after delivery; Lightroom exports them
with a new sequence (`svatba_001_PPR57923.jpg`), so the name no longer equals the delivered one
(`svatba_0412_PPR57923.jpg`). Deleting the old photo and uploading the new one would move it in
file-name order and lose everything tied to its id.

## How it works

- **Pairing** (`shotKey`, `replaceCandidates`, all of it planned by `planPick` in
  `src/lib/upload-resume.ts`): the shot is the camera's own name — what follows the export's last
  `_<digits>_` sequence, or a bare name (`PPR55013.jpg`, an export without a sequence — Pavel's own
  fix set, 2026-10-19) — with a Photoshop `-Edit` dropped and the extension kept. No key without
  letters and digits both (`2026-09-05_0412.jpg`, `IMG_4821-2.jpg`). Two picked files with one key
  pair with nothing.
- **Every pair is a choice.** The admin uploader lists each one before anything is signed, as a
  select. Only a single candidate whose delivered name carries a sequence comes pre-selected; a
  camera-named delivery, a gallery named by sequence alone (`svatba_0001.jpg` — a second batch
  numbered from 1 would pair with unrelated photos) and several candidates (Lightroom virtual
  copies, `svatba_0215_PPR55013` and `svatba_0216_PPR55013`) wait for a pick. Any pair can be
  turned down — two bodies' `DSC_0412` are different moments — and the line then says where the
  file goes. "Nahrát beze změn" uploads everything under its own name; no other pick is taken
  meanwhile.
- **New shots** with a bare camera name are filed by `slotter`: stored under the sequence of the
  same camera's nearest lower number (`PPR56518.jpg` → `svatba_0384_PPR56518.jpg`, after
  `svatba_0384_PPR56511.jpg`), so file-name order puts them where they were shot — a declined pair
  lands right before its twin. The camera counter, not the clock: exact within one body whatever its
  clock says; two bodies sharing a prefix, or a counter that wrapped past 9999, land wrong.
- **Resuming** an interrupted run matches a pending row by the name it was stored under — the
  file's own first, then the filed one, each row once — keeps that name, and keeps replacing what
  the row was replacing; if that photo was deleted since, the review says so.
- **Upload** goes the normal way to a new key (objects are `immutable`), on a PENDING row carrying
  `Photo.replacesPhotoId`. Expired-signature re-signing works unchanged; a resumed row takes the
  choice made now (turning the pair down clears it).
- **Confirm** (`replacePhotoBytes`, `api/uploads/confirm`) moves the new key, thumbnail, size,
  CRC32, and — where the browser read them — dimensions, placeholder and Lightroom marks onto the
  target row, then deletes the old objects. The target keeps its id, `fileName` and `takenAt`, so
  its place in every order (chapter starts included) — favourites, print marks, reactions, face
  names, chapters, cover all stay. `faces` and `checkKeptAt` are cleared: read from the old pixels.
- The swap is guarded on the target's key, so two replacements racing each other cannot orphan an
  object (the loser answers `409 replace_conflict` and its retry replaces the winner).
- The upload's row stays as a **FAILED tombstone** with its key released, so a retried confirm whose
  first answer was lost still succeeds; the ghost cleanup removes it after 24 hours.
- A target deleted meanwhile makes the upload an ordinary new photo rather than losing the file.

Not done: guests' uploads (never paired), videos, and a new shot whose camera has nothing delivered
before it — that one keeps its own name (docs/PHOTO-ORDER.md).
