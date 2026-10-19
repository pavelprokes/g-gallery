"use client";

import { useMemo, useState } from "react";
import { pluralize } from "@/lib/czech-plural";
import {
  faceTiles,
  MAX_PERSON_NAME,
  seriesMatches,
  TAG_MATCH_IOU,
  type Box,
  type FaceTile,
  type TaggedBox,
} from "@/lib/social-video/face-tags";
import { iou, type Face, type PhotoFaces } from "@/lib/social-video/faces";
import {
  createPerson,
  deletePerson,
  tagFace,
  tagFaces,
  untagFace,
  updatePerson,
  type PersonResult,
} from "@/app/admin/face-tag-actions";
import { FaceZoom } from "@/components/admin/face-zoom";
import {
  FaceScanControls,
  PHOTO_GENITIVE,
  useFaceFinder,
  useFaceScan,
} from "@/components/admin/face-scan";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Hint, Input, Label, Select } from "@/components/ui/input";

// docs/SOCIAL-VIDEO.md §4, "Who is who": the photographer picks someone, then
// clicks their faces. Names are typed, never recognised — what nobody tagged,
// nobody knows.

export interface TagPhoto {
  id: string;
  objectKey: string;
  fileName: string;
  width: number;
  height: number;
  /** Capture time, epoch ms — what tells a series (`seriesMatches`). */
  takenAt: number | null;
  faces: PhotoFaces | null;
  tags: TaggedBox[];
}

/** The same face on the next shots of a series, offered after a click. */
interface Offer {
  personId: string;
  matches: { photoId: string; face: Face }[];
}

type Person = PersonResult;

/** Faces shown at once; "Zobrazit další" adds as many again. */
const PAGE = 480;
const TILE = 88;
const FACE_FORMS = { one: "tvář", few: "tváře", many: "tváří" };
/** After "na": the locative. */
const NEIGHBOUR_FORMS = {
  one: "sousední fotce",
  few: "sousedních fotkách",
  many: "sousedních fotkách",
};
/** The couple, one click each — the names can be changed afterwards. */
const COUPLE_PRESETS = ["Nevěsta", "Ženich"];

const faceKey = (photoId: string, face: Box) => `${photoId}:${face.x}:${face.y}`;
const tileKey = (tile: FaceTile) => faceKey(tile.photoId, tile.face);

/** `tags` with `personId` on `box`: the face loses its old name, the person
 * their old face on this photo — as the server does it. */
const withTag = (tags: TaggedBox[], personId: string, box: Box): TaggedBox[] => [
  ...tags.filter((t) => t.personId !== personId && iou(t, box) < TAG_MATCH_IOU),
  { personId, ...box },
];
const boxOf = ({ x, y, w, h }: Box): Box => ({ x, y, w, h });

export function FaceTagBoard({
  galleryId,
  photos: initial,
  initialPeople,
}: {
  galleryId: string;
  photos: TagPhoto[];
  initialPeople: Person[];
}) {
  const [photos, setPhotos] = useState(initial);
  const [people, setPeople] = useState(initialPeople);
  const [active, setActive] = useState<string | null>(initialPeople[0]?.id ?? null);
  const [filter, setFilter] = useState<string>("untagged");
  const [shown, setShown] = useState(PAGE);
  // Faces named while "Neoznačené" is open stay in place until the filter
  // changes — a list that closes up under the pointer gets the next face
  // clicked by mistake.
  const [stay, setStay] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);

  const finder = useFaceFinder();
  const withFaces = photos.filter((p) => p.faces).length;
  const faceScan = useFaceScan({
    galleryId,
    finder,
    missing: () => photos.filter((p) => !p.faces),
    onSaved: (entries) => {
      const found = new Map(entries.map((e) => [e.photoId, e.faces]));
      setPhotos((prev) =>
        prev.map((p) => (found.has(p.id) ? { ...p, faces: found.get(p.id)! } : p)),
      );
    },
  });

  const byId = useMemo(() => new Map(photos.map((p) => [p.id, p])), [photos]);
  const tiles = useMemo(
    () => faceTiles(photos.map((p) => ({ id: p.id, faces: p.faces?.faces ?? null, tags: p.tags }))),
    [photos],
  );
  const photoCount = (personId: string) =>
    photos.filter((p) => p.tags.some((t) => t.personId === personId)).length;
  const untagged = tiles.filter((t) => t.personId === null).length;
  const visible = tiles.filter((t) =>
    filter === "all"
      ? true
      : filter === "untagged"
        ? t.personId === null || stay.has(tileKey(t))
        : t.personId === filter,
  );
  const activePerson = people.find((p) => p.id === active) ?? null;

  const changeFilter = (value: string) => {
    setFilter(value);
    setShown(PAGE);
    setStay(new Set());
  };

  const setTags = (photoId: string, tags: TaggedBox[]) =>
    setPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, tags } : p)));

  const offered = new Set(offer?.matches.map((m) => faceKey(m.photoId, m.face)));

  const toggle = async (tile: FaceTile) => {
    setError(null);
    setOffer(null);
    if (!active) {
      setError("Nejdřív nahoře vyber, koho označuješ.");
      return;
    }
    const before = byId.get(tile.photoId)?.tags ?? [];
    const box = boxOf(tile.face);
    const naming = tile.personId !== active;
    const after = naming
      ? withTag(before, active, box)
      : before.filter((t) => t.personId !== active);
    setTags(tile.photoId, after);
    if (filter === "untagged") setStay((prev) => new Set(prev).add(tileKey(tile)));
    try {
      if (naming) await tagFace(tile.photoId, active, box);
      else await untagFace(tile.photoId, active);
    } catch {
      setTags(tile.photoId, before);
      setError("Nepodařilo se to uložit. Zkus to znovu.");
      return;
    }
    if (!naming) return;
    // The same place on the shots either side of a burst: offered, never
    // named without a click.
    const matches = seriesMatches(
      photos.map((p) => ({
        ...p,
        faces: p.faces?.faces ?? null,
        tags: p.id === tile.photoId ? after : p.tags,
      })),
      tile.photoId,
      box,
      active,
    );
    if (matches.length > 0) setOffer({ personId: active, matches });
  };

  const acceptOffer = async () => {
    if (!offer) return;
    const { personId, matches } = offer;
    setOffer(null);
    setError(null);
    const before = new Map(matches.map((m) => [m.photoId, byId.get(m.photoId)?.tags ?? []]));
    setPhotos((prev) =>
      prev.map((p) => {
        const match = matches.find((m) => m.photoId === p.id);
        return match ? { ...p, tags: withTag(p.tags, personId, boxOf(match.face)) } : p;
      }),
    );
    if (filter === "untagged") {
      setStay((prev) => new Set([...prev, ...matches.map((m) => faceKey(m.photoId, m.face))]));
    }
    try {
      await tagFaces(
        personId,
        matches.map((m) => ({ photoId: m.photoId, box: boxOf(m.face) })),
      );
    } catch {
      setPhotos((prev) =>
        prev.map((p) => (before.has(p.id) ? { ...p, tags: before.get(p.id)! } : p)),
      );
      setError("Nepodařilo se to uložit. Zkus to znovu.");
    }
  };

  const add = async (name: string, couple: boolean) => {
    setError(null);
    setBusy(true);
    try {
      const person = await createPerson(galleryId, name, couple);
      setPeople((prev) => [...prev, person]);
      setActive(person.id);
      return true;
    } catch {
      setError("Nepodařilo se přidat. Zkus to znovu.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (person: Person, name: string, couple: boolean) => {
    setError(null);
    setBusy(true);
    try {
      await updatePerson(person.id, name, couple);
      setPeople((prev) => prev.map((p) => (p.id === person.id ? { ...p, name, couple } : p)));
    } catch {
      setError("Nepodařilo se to uložit. Zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (person: Person) => {
    const count = photoCount(person.id);
    const where = count > 0 ? ` Zmizí i ze ${pluralize(count, PHOTO_GENITIVE)}.` : "";
    if (!window.confirm(`Smazat „${person.name}“?${where}`)) return;
    setError(null);
    setBusy(true);
    try {
      await deletePerson(person.id);
      setPeople((prev) => prev.filter((p) => p.id !== person.id));
      setPhotos((prev) =>
        prev.map((p) => ({ ...p, tags: p.tags.filter((t) => t.personId !== person.id) })),
      );
      if (active === person.id) setActive(null);
      if (filter === person.id) changeFilter("untagged");
    } catch {
      setError("Nepodařilo se smazat. Zkus to znovu.");
    } finally {
      setBusy(false);
    }
  };

  const missingPresets = COUPLE_PRESETS.filter((name) => !people.some((p) => p.name === name));

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Lidé</CardTitle>
        <p className="mb-3">
          Vyber člověka a pak klikej na jeho tváře. Novomanželé mají ve videu pro sítě přednost a
          kamera na ně ve skupině zamíří — ve videu i v projekci na svatbě.
        </p>
        <p className="text-admin-muted text-caption mb-4 dark:text-neutral-400">
          Jména vidíš jen ty, hostům se nikde neukazují. Nic se nerozpoznává automaticky: kde tvář
          neoznačíš, tam aplikace neví, kdo to je.
        </p>

        {people.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Koho označuješ">
            {people.map((person) => {
              const chosen = person.id === active;
              return (
                <button
                  key={person.id}
                  type="button"
                  aria-pressed={chosen}
                  aria-label={`${person.name}${person.couple ? ", novomanželé" : ""} · ${photoCount(person.id)}`}
                  onClick={() => setActive(chosen ? null : person.id)}
                  className={`min-h-11 rounded-full border px-4 text-sm transition-colors ${
                    chosen
                      ? "border-brand-primary bg-brand-tint text-brand-primary-dark font-semibold"
                      : "border-admin-border hover:border-brand-primary text-brand-ink bg-white dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200"
                  }`}
                >
                  {person.name}
                  {person.couple && " ♥"} · {photoCount(person.id)}
                </button>
              );
            })}
          </div>
        )}

        {activePerson && (
          <PersonEditor
            key={activePerson.id}
            person={activePerson}
            busy={busy}
            onSave={(name, couple) => void save(activePerson, name, couple)}
            onDelete={() => void remove(activePerson)}
          />
        )}

        <div className="mt-4 space-y-3">
          {missingPresets.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {missingPresets.map((name) => (
                <Button
                  key={name}
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void add(name, true)}
                >
                  Přidat: {name}
                </Button>
              ))}
            </div>
          )}
          <NewPerson busy={busy} onAdd={add} />
        </div>
      </Card>

      <Card>
        <CardTitle>Tváře v galerii</CardTitle>
        <p className="mb-3">
          Tváře známe u {withFaces} z {pluralize(photos.length, PHOTO_GENITIVE)}.
        </p>
        <FaceScanControls
          scan={faceScan.scan}
          missing={photos.length - withFaces}
          onStart={() => void faceScan.start()}
          onPause={faceScan.pause}
          idleLabel={(count) => `Najít tváře (${count})`}
          doneLabel="Tváře jsou nalezené na všech fotkách"
          finishedText="Hotovo."
        />
      </Card>

      {error && (
        <Alert tone="danger" compact>
          {error}
        </Alert>
      )}

      <section aria-labelledby="faces-list" className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <h2 id="faces-list" className="text-lg font-semibold">
              {pluralize(visible.length, FACE_FORMS)}
            </h2>
            {/* On a phone the people are a screen above: say whom a click names. */}
            <p className="text-caption" aria-live="polite">
              {activePerson ? (
                <>
                  Označuješ: <strong>{activePerson.name}</strong>
                </>
              ) : (
                "Nikoho nemáš vybraného."
              )}
            </p>
          </div>
          <div className="w-64 max-w-full">
            <Label htmlFor="faces-filter">Zobrazit</Label>
            <Select
              id="faces-filter"
              value={filter}
              onChange={(event) => changeFilter(event.target.value)}
            >
              <option value="untagged">Neoznačené ({untagged})</option>
              <option value="all">Všechny ({tiles.length})</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} ({tiles.filter((t) => t.personId === person.id).length})
                </option>
              ))}
            </Select>
          </div>
        </div>
        {withFaces === 0 ? (
          <p className="text-admin-muted dark:text-neutral-400">
            Nejdřív je potřeba najít tváře — klikni na „Najít tváře“.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-admin-muted dark:text-neutral-400">Tady nic není.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-3">
              {visible.slice(0, shown).map((tile) => {
                const photo = byId.get(tile.photoId)!;
                const name = people.find((p) => p.id === tile.personId)?.name ?? null;
                const mine = tile.personId !== null && tile.personId === active;
                return (
                  <li key={tileKey(tile)} style={{ width: TILE }}>
                    <button
                      type="button"
                      aria-pressed={mine}
                      aria-label={`Tvář na fotce ${photo.fileName}${name ? `, ${name}` : ""}`}
                      title={photo.fileName}
                      onClick={() => void toggle(tile)}
                      className={`block rounded-lg p-0.5 ring-offset-1 ${
                        mine
                          ? "ring-brand-primary ring-3"
                          : "hover:ring-admin-border ring-transparent hover:ring-2"
                      } ${offered.has(tileKey(tile)) ? "outline-brand-primary outline-2 outline-dashed" : ""}`}
                    >
                      <FaceZoom photo={photo} face={tile.face} size={TILE - 4} alt="" />
                    </button>
                    <p
                      className={`text-caption mt-1 truncate text-center ${
                        name ? "font-medium" : "text-admin-muted dark:text-neutral-500"
                      }`}
                    >
                      {name ?? "—"}
                    </p>
                  </li>
                );
              })}
            </ul>
            {visible.length > shown && (
              <Button variant="secondary" onClick={() => setShown((n) => n + PAGE)}>
                Zobrazit další
              </Button>
            )}
          </>
        )}
      </section>

      {offer && (
        <div
          role="status"
          className="border-admin-border fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-xl flex-wrap items-center gap-3 rounded-xl border bg-white p-3 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
        >
          <p className="min-w-0 flex-1 basis-56 text-sm">
            Na stejném místě je tvář i na {pluralize(offer.matches.length, NEIGHBOUR_FORMS)} ze
            série. Označit i tam jako{" "}
            <strong>{people.find((p) => p.id === offer.personId)?.name}</strong>?
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void acceptOffer()}>
              Označit i tam
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOffer(null)}>
              Ne
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonEditor({
  person,
  busy,
  onSave,
  onDelete,
}: {
  person: Person;
  busy: boolean;
  onSave: (name: string, couple: boolean) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(person.name);
  const [couple, setCouple] = useState(person.couple);
  const changed = name.trim() !== person.name || couple !== person.couple;
  return (
    <form
      className="border-admin-border space-y-3 rounded-lg border p-3 dark:border-neutral-700"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) onSave(name.trim(), couple);
      }}
    >
      <div>
        <Label htmlFor="person-name">Jméno</Label>
        <Input
          id="person-name"
          value={name}
          maxLength={MAX_PERSON_NAME}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <CoupleCheckbox checked={couple} onChange={setCouple} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={busy || !changed || !name.trim()}>
          Uložit
        </Button>
        <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={onDelete}>
          Smazat
        </Button>
      </div>
    </form>
  );
}

function NewPerson({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (name: string, couple: boolean) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [couple, setCouple] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!name.trim()) return;
        if (await onAdd(name.trim(), couple)) {
          setName("");
          setCouple(false);
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <Label htmlFor="new-person">Přidat člověka</Label>
          <Input
            id="new-person"
            value={name}
            maxLength={MAX_PERSON_NAME}
            placeholder="Např. Babička Jana"
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={busy || !name.trim()}>
          Přidat
        </Button>
      </div>
      <CoupleCheckbox checked={couple} onChange={setCouple} disabled={busy} />
      <Hint>Svědky, rodiče nebo družičky můžeš přidat taky — zatím jen pro tvůj přehled.</Hint>
    </form>
  );
}

function CoupleCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-brand-primary size-4"
      />
      Patří k novomanželům
    </label>
  );
}
