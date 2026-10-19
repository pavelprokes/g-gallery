# Replacing photos with a corrected export

Adopted 2026-10-19. A couple asks for a few retouched photos after delivery; Lightroom exports them
with a new sequence (`svatba_001_PPR57923.jpg`), so the name no longer equals the delivered one
(`svatba_0412_PPR57923.jpg`). Deleting the old photo and uploading the new one would move it in
file-name order and lose everything tied to its id.

## How it works

- **Pairing** (`shotKey`, `matchReplaceTargets` in `src/lib/upload-resume.ts`): the name minus its
  last `_<digits>_` sequence is the shot — the camera's own name. A pick is paired only when its key
  is unique among the picked files _and_ among the gallery's CONFIRMED, OWNER, non-video photos; two
  bodies sharing a counter make it a guess, and a guess would overwrite a photo.
- **Asked, never assumed.** The admin uploader lists each pair ("→ nahradí …") before anything is
  signed: replace them, upload everything as new, or cancel.
- **Upload** goes the normal way to a new key (objects are `immutable`), on a PENDING row carrying
  `Photo.replacesPhotoId`. Resume and expired-signature re-signing work unchanged.
- **Confirm** (`replacePhotoBytes`, `api/uploads/confirm`) moves the new key, thumbnail, size,
  CRC32, dimensions and placeholder onto the target row and deletes the upload's row, then the old
  objects. The target keeps its id, `fileName` (with the new extension), `takenAt` and so its place
  in every order — favourites, print marks, reactions, face names, chapters, cover all stay.
  `faces` and `checkKeptAt` are cleared: they were read from the old pixels.
- A target deleted meanwhile makes the upload an ordinary new photo rather than losing the file.

Not done: guests' uploads (never paired), videos, and new photos without a match — those are placed
by their own name as before (docs/PHOTO-ORDER.md).
