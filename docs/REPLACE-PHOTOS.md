# Replacing photos with a corrected export

Adopted 2026-10-19. A couple asks for a few retouched photos after delivery; Lightroom exports them
with a new sequence (`svatba_001_PPR57923.jpg`), so the name no longer equals the delivered one
(`svatba_0412_PPR57923.jpg`). Deleting the old photo and uploading the new one would move it in
file-name order and lose everything tied to its id.

## How it works

- **Pairing** (`shotKey`, `matchReplaceTargets` in `src/lib/upload-resume.ts`): the name minus its
  last `_<digits>_` sequence is the shot — the camera's own name, with a Photoshop `-Edit` dropped
  and the extension kept. No key without a camera name (letters and digits) after a sequence:
  `2026-09-05_0412.jpg` or `IMG_4821-2.jpg` would pair unrelated shots. A pick is paired only when
  its key is unique among the picked files _and_ among the gallery's CONFIRMED, OWNER, non-video
  photos; two bodies sharing a counter make it a guess, and a guess would delete a photo.
- **Asked, never assumed.** The admin uploader lists each pair ("→ nahradí …") before anything is
  signed: replace them, upload everything as new, or cancel. No other pick is taken meanwhile.
- **Upload** goes the normal way to a new key (objects are `immutable`), on a PENDING row carrying
  `Photo.replacesPhotoId`. Resume and expired-signature re-signing work unchanged; a resumed row
  takes the choice made now ("as new" clears it).
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

Not done: guests' uploads (never paired), videos, and new photos without a match — those are placed
by their own name as before (docs/PHOTO-ORDER.md).
