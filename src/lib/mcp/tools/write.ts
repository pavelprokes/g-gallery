import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  attachGalleryToEventFor,
  createEventFor,
  createGalleryFor,
  createGalleryInEventFor,
  createShareLinkFor,
  publishGalleryFor,
  setCorrectionResolvedFor,
  setGalleryCoverFor,
  setGalleryEventLinkFor,
  setGalleryListedFor,
  setShareLinkPermissionsFor,
  unpublishGalleryFor,
  updateEventFor,
  updateGalleryFor,
} from "@/lib/gallery-admin";
import { decryptToken } from "@/lib/token-cipher";
import { defineTool, jsonResult } from "../tool";
import { McpToolError } from "../types";
import {
  adminGalleryUrl,
  adminWeddingUrl,
  day,
  dayInput,
  idInput,
  notFound,
  owned,
  parseDay,
  shareLinkUrl,
  titleInput,
  weddingUrl,
} from "./common";

// Everything here creates or sets — never deletes, revokes or trashes. Those
// are one-way for the guests who hold a link and stay a click in the admin
// (docs/MCP.md §What it cannot do).

const descriptionInput = z.string().trim().max(2000);
const venueInput = z.string().trim().max(200);

const GALLERY_NOT_FOUND = "Galerie nenalezena";
const WEDDING_NOT_FOUND = "Svatba nenalezena";

async function ownedGallery(ownerId: string, galleryId: string) {
  const gallery = await prisma.gallery.findFirst({
    where: { id: galleryId, ownerId },
    select: {
      id: true,
      title: true,
      eventDate: true,
      description: true,
      status: true,
      eventId: true,
      eventLinkId: true,
      trashedAt: true,
    },
  });
  if (!gallery) throw notFound(GALLERY_NOT_FOUND);
  return gallery;
}

async function shareLinkSummary(origin: string, shareLinkId: string) {
  const link = await prisma.shareLink.findUniqueOrThrow({
    where: { id: shareLinkId },
    select: {
      id: true,
      label: true,
      slug: true,
      tokenCipher: true,
      expiresAt: true,
      passwordHash: true,
      allowDownload: true,
      allowReactions: true,
      allowPrintSelection: true,
      allowUpload: true,
      allowCorrections: true,
      correctionPinCipher: true,
    },
  });
  return {
    id: link.id,
    label: link.label,
    url: shareLinkUrl(origin, link),
    expiresAt: link.expiresAt?.toISOString() ?? null,
    password: link.passwordHash !== null,
    allowDownload: link.allowDownload,
    allowReactions: link.allowReactions,
    allowPrintSelection: link.allowPrintSelection,
    allowUpload: link.allowUpload,
    allowCorrections: link.allowCorrections,
    correctionPin: link.allowCorrections ? decryptToken(link.correctionPinCipher) : null,
  };
}

export const galleryCreate = defineTool({
  name: "gallery_create",
  title: "Založit galerii",
  description:
    "Založí galerii. Bez wedding_id vznikne koncept bez odkazu — pak share_link_create a gallery_publish. S wedding_id vznikne rovnou zveřejněná galerie připojená ke svatbě i se sdíleným odkazem pro kartu („Pro pár“, nebo „Pro hosty“ s nahráváním), ale na rozcestníku ji hosté uvidí až po wedding_set_gallery_listed. Fotky se nahrávají jen v administraci.",
  input: z.strictObject({
    title: titleInput.describe("Název, např. „Svatba Petra a Jana“ nebo „Obřad“."),
    event_date: dayInput.optional().describe("Den svatby, RRRR-MM-DD."),
    description: descriptionInput
      .optional()
      .describe("Poznámka jen pro administraci; hosté ji nevidí."),
    wedding_id: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe("Svatba, ke které galerii rovnou připojit."),
    guest_uploads: z
      .boolean()
      .default(false)
      .describe(
        "Jen s wedding_id: galerie pro fotky od hostů (hosté nahrávají, řazení podle času).",
      ),
  }),
  access: "write",
  handler: async (args, caller) => {
    if (args.guest_uploads && !args.wedding_id) {
      throw new McpToolError("guest_uploads jde jen spolu s wedding_id.");
    }
    const fields = {
      title: args.title,
      eventDate: args.event_date ? parseDay(args.event_date) : null,
      description: args.description || null,
    };
    if (!args.wedding_id) {
      const id = await createGalleryFor(caller.userId, fields);
      return jsonResult({
        id,
        status: "DRAFT",
        adminUrl: adminGalleryUrl(caller.origin, id),
        next: "Nahraj fotky v administraci, vytvoř odkaz (share_link_create) a galerii zveřejni (gallery_publish).",
      });
    }
    const created = await owned(
      createGalleryInEventFor(caller.userId, args.wedding_id, {
        ...fields,
        allowUpload: args.guest_uploads,
      }),
      WEDDING_NOT_FOUND,
    );
    return jsonResult({
      id: created.galleryId,
      status: "PUBLISHED",
      weddingId: args.wedding_id,
      listedOnWeddingPage: false,
      cardShareLink: await shareLinkSummary(caller.origin, created.shareLinkId),
      adminUrl: adminGalleryUrl(caller.origin, created.galleryId),
      next: "Až bude galerie hotová, ukaž ji na rozcestníku: wedding_set_gallery_listed s listed=true.",
    });
  },
});

export const galleryUpdate = defineTool({
  name: "gallery_update",
  title: "Upravit galerii",
  description:
    "Změní název, den svatby nebo poznámku galerie; co nepošleš, zůstane. Adresy už rozeslaných odkazů se nemění (část za tokenem zůstává podle původního názvu). Překlady názvu se upravují v administraci.",
  input: z.strictObject({
    gallery_id: idInput("galerie"),
    title: titleInput.optional(),
    event_date: dayInput.nullable().optional().describe("RRRR-MM-DD, null datum smaže."),
    description: descriptionInput.nullable().optional().describe("null poznámku smaže."),
  }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    if (
      args.title === undefined &&
      args.event_date === undefined &&
      args.description === undefined
    ) {
      throw new McpToolError("Pošli aspoň jedno z: title, event_date, description.");
    }
    const gallery = await ownedGallery(caller.userId, args.gallery_id);
    const title = args.title ?? gallery.title;
    const eventDate =
      args.event_date === undefined
        ? gallery.eventDate
        : args.event_date
          ? parseDay(args.event_date)
          : null;
    const description =
      args.description === undefined ? gallery.description : args.description || null;
    await owned(
      updateGalleryFor(caller.userId, gallery.id, { title, eventDate, description }),
      GALLERY_NOT_FOUND,
    );
    return jsonResult({ id: gallery.id, title, eventDate: day(eventDate), description });
  },
});

export const galleryPublish = defineTool({
  name: "gallery_publish",
  title: "Zveřejnit galerii",
  description:
    "Zveřejní galerii: od teď ji otevře každý, kdo má platný sdílený odkaz (a karta na rozcestníku, je-li zobrazená). Vrací odkazy, přes které je vidět.",
  input: z.strictObject({ gallery_id: idInput("galerie") }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    const gallery = await ownedGallery(caller.userId, args.gallery_id);
    if (gallery.trashedAt) throw new McpToolError("Galerie je v koši. Obnov ji v administraci.");
    await publishGalleryFor(caller.userId, gallery.id);
    const links = await prisma.shareLink.findMany({
      where: { galleryId: gallery.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, slug: true, tokenCipher: true, expiresAt: true },
    });
    const now = new Date();
    const live = links.filter((link) => !link.expiresAt || link.expiresAt > now);
    return jsonResult({
      id: gallery.id,
      status: "PUBLISHED",
      shareLinks: live.map((link) => ({
        id: link.id,
        label: link.label,
        url: shareLinkUrl(caller.origin, link),
      })),
      ...(live.length === 0
        ? { next: "Galerie zatím nemá platný odkaz — vytvoř ho přes share_link_create." }
        : {}),
    });
  },
});

export const galleryUnpublish = defineTool({
  name: "gallery_unpublish",
  title: "Stáhnout galerii",
  description:
    "Vrátí galerii do konceptu. Všechny její odkazy i karta na rozcestníku okamžitě přestanou fungovat, dokud ji znovu nezveřejníš. Použij jen na výslovný pokyn.",
  input: z.strictObject({ gallery_id: idInput("galerie") }),
  access: "write-idempotent",
  disruptive: true,
  handler: async (args, caller) => {
    await owned(unpublishGalleryFor(caller.userId, args.gallery_id), GALLERY_NOT_FOUND);
    return jsonResult({ id: args.gallery_id, status: "DRAFT" });
  },
});

export const gallerySetCover = defineTool({
  name: "gallery_set_cover",
  title: "Nastavit obálku",
  description:
    "Vybere fotku, kterou galerie začíná (obálka v administraci, na rozcestníku a v náhledu odkazu). photo_id null vrátí automatickou volbu (nejnovější fotka).",
  input: z.strictObject({
    gallery_id: idInput("galerie"),
    photo_id: z.string().min(1).max(64).nullable().describe("Fotka této galerie, nebo null."),
  }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    await owned(
      setGalleryCoverFor(caller.userId, args.gallery_id, args.photo_id),
      args.photo_id ? "Galerie nebo fotka v ní nenalezena" : GALLERY_NOT_FOUND,
    );
    return jsonResult({ id: args.gallery_id, coverPhotoId: args.photo_id });
  },
});

const permissionInputs = {
  allow_download: z.boolean().describe("Stahování fotek i celého archivu."),
  allow_reactions: z.boolean().describe("Srdíčka a reakce."),
  allow_print_selection: z.boolean().describe("Označování do tisku."),
  allow_upload: z.boolean().describe("Hosté smí nahrávat vlastní fotky."),
  allow_corrections: z.boolean().describe("Připomínky k fotkám za 6místným PINem (jen pro pár)."),
};

export const shareLinkCreate = defineTool({
  name: "share_link_create",
  title: "Vytvořit sdílený odkaz",
  description:
    "Vytvoří nový odkaz na galerii a vrátí jeho adresu (a PIN, když jsou zapnuté připomínky). Výchozí je „předání fotek“: stahování, srdíčka a tisk zapnuté, nahrávání a připomínky vypnuté, bez hesla a bez expirace. Na ochutnávku na sítě: allow_download=false, allow_print_selection=false, expires_in_days=14.",
  input: z.strictObject({
    gallery_id: idInput("galerie"),
    label: z.string().trim().min(1).max(200).optional().describe("Pro koho je, např. „Pro pár“."),
    password: z.string().min(4).max(200).optional().describe("Heslo, které hosté zadají."),
    expires_in_days: z.number().int().min(1).max(3650).optional().describe("Platnost ve dnech."),
    allow_download: permissionInputs.allow_download.default(true),
    allow_reactions: permissionInputs.allow_reactions.default(true),
    allow_print_selection: permissionInputs.allow_print_selection.default(true),
    allow_upload: permissionInputs.allow_upload.default(false),
    allow_corrections: permissionInputs.allow_corrections.default(false),
  }),
  access: "write",
  handler: async (args, caller) => {
    const gallery = await ownedGallery(caller.userId, args.gallery_id);
    const link = await owned(
      createShareLinkFor(caller.userId, {
        galleryId: gallery.id,
        label: args.label,
        password: args.password,
        expiresInDays: args.expires_in_days,
        allowDownload: args.allow_download,
        allowReactions: args.allow_reactions,
        allowPrintSelection: args.allow_print_selection,
        allowUpload: args.allow_upload,
        allowCorrections: args.allow_corrections,
      }),
      GALLERY_NOT_FOUND,
    );
    const summary = await shareLinkSummary(caller.origin, link.id);
    return jsonResult({
      ...summary,
      // The raw token is in hand right now even when it cannot be stored for display.
      url: summary.url ?? `${caller.origin}/g/${link.token}/${link.slug}`,
      ...(gallery.status !== "PUBLISHED"
        ? { next: "Galerie je koncept — hosté ji přes odkaz uvidí až po gallery_publish." }
        : {}),
    });
  },
});

export const shareLinkSetPermissions = defineTool({
  name: "share_link_set_permissions",
  title: "Změnit oprávnění odkazu",
  description:
    "Zapne nebo vypne, co smí držitelé už rozeslaného odkazu; adresa, heslo i platnost zůstávají. Co nepošleš, zůstane, jak je. První zapnutí připomínek vytvoří PIN.",
  input: z.strictObject({
    share_link_id: idInput("sdíleného odkazu (z gallery_get)"),
    allow_download: permissionInputs.allow_download.optional(),
    allow_reactions: permissionInputs.allow_reactions.optional(),
    allow_print_selection: permissionInputs.allow_print_selection.optional(),
    allow_upload: permissionInputs.allow_upload.optional(),
    allow_corrections: permissionInputs.allow_corrections.optional(),
  }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    const link = await prisma.shareLink.findFirst({
      where: { id: args.share_link_id, gallery: { ownerId: caller.userId } },
      select: {
        id: true,
        revokedAt: true,
        allowDownload: true,
        allowReactions: true,
        allowPrintSelection: true,
        allowUpload: true,
        allowCorrections: true,
      },
    });
    if (!link) throw notFound("Sdílený odkaz nenalezen");
    if (link.revokedAt)
      throw new McpToolError("Odkaz je zrušený; vytvoř nový přes share_link_create.");
    await owned(
      setShareLinkPermissionsFor(caller.userId, link.id, {
        allowDownload: args.allow_download ?? link.allowDownload,
        allowReactions: args.allow_reactions ?? link.allowReactions,
        allowPrintSelection: args.allow_print_selection ?? link.allowPrintSelection,
        allowUpload: args.allow_upload ?? link.allowUpload,
        allowCorrections: args.allow_corrections ?? link.allowCorrections,
      }),
      "Sdílený odkaz nenalezen",
    );
    return jsonResult(await shareLinkSummary(caller.origin, link.id));
  },
});

export const weddingCreate = defineTool({
  name: "wedding_create",
  title: "Založit svatbu",
  description:
    "Založí svatbu — rozcestník pro hosty s vlastní tajnou adresou, oddělenou od odkazů na galerie. Galerie do ní přidáš přes gallery_create s wedding_id nebo wedding_add_gallery.",
  input: z.strictObject({
    title: titleInput.describe("Např. „Petra a Jan“."),
    event_date: dayInput.optional().describe("Den svatby, RRRR-MM-DD."),
    venue: venueInput.optional().describe("Místo, např. „Statek Benice“."),
  }),
  access: "write",
  handler: async (args, caller) => {
    const eventDate = args.event_date ? parseDay(args.event_date) : null;
    const event = await createEventFor(caller.userId, {
      title: args.title,
      eventDate,
      venue: args.venue || null,
    });
    return jsonResult({
      id: event.id,
      title: args.title,
      eventDate: day(eventDate),
      venue: args.venue || null,
      guestUrl: `${caller.origin}/s/${event.token}/${event.slug}`,
      adminUrl: adminWeddingUrl(caller.origin, event.id),
    });
  },
});

export const weddingUpdate = defineTool({
  name: "wedding_update",
  title: "Upravit svatbu",
  description:
    "Změní název, den nebo místo svatby; co nepošleš, zůstane. Adresa rozcestníku se nemění. Překlady se upravují v administraci.",
  input: z.strictObject({
    wedding_id: idInput("svatby"),
    title: titleInput.optional(),
    event_date: dayInput.nullable().optional().describe("RRRR-MM-DD, null datum smaže."),
    venue: venueInput.nullable().optional().describe("null místo smaže."),
  }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    if (args.title === undefined && args.event_date === undefined && args.venue === undefined) {
      throw new McpToolError("Pošli aspoň jedno z: title, event_date, venue.");
    }
    const event = await prisma.event.findFirst({
      where: { id: args.wedding_id, ownerId: caller.userId },
      select: {
        id: true,
        title: true,
        eventDate: true,
        venue: true,
        slug: true,
        tokenCipher: true,
      },
    });
    if (!event) throw notFound(WEDDING_NOT_FOUND);
    const title = args.title ?? event.title;
    const eventDate =
      args.event_date === undefined
        ? event.eventDate
        : args.event_date
          ? parseDay(args.event_date)
          : null;
    const venue = args.venue === undefined ? event.venue : args.venue || null;
    await updateEventFor(caller.userId, event.id, { title, eventDate, venue });
    return jsonResult({
      id: event.id,
      title,
      eventDate: day(eventDate),
      venue,
      guestUrl: weddingUrl(caller.origin, event),
    });
  },
});

export const weddingAddGallery = defineTool({
  name: "wedding_add_gallery",
  title: "Přidat galerii ke svatbě",
  description:
    "Připojí existující galerii ke svatbě jako kartu (zatím skrytou) a volitelně určí, přes který její sdílený odkaz karta vede. Galerii, která už patří jiné svatbě, přesuň v administraci.",
  input: z.strictObject({
    wedding_id: idInput("svatby"),
    gallery_id: idInput("galerie"),
    card_share_link_id: z
      .string()
      .min(1)
      .max(64)
      .optional()
      .describe(
        "Odkaz této galerie, přes který karta vede (z gallery_get). Bez něj karta hostům nepůjde zobrazit.",
      ),
  }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    const gallery = await ownedGallery(caller.userId, args.gallery_id);
    if (gallery.eventId && gallery.eventId !== args.wedding_id) {
      throw new McpToolError("Galerie už patří k jiné svatbě. Přesuň ji v administraci.");
    }
    if (!gallery.eventId) {
      await owned(
        attachGalleryToEventFor(caller.userId, args.wedding_id, gallery.id),
        WEDDING_NOT_FOUND,
      );
    }
    if (args.card_share_link_id) {
      await owned(
        setGalleryEventLinkFor(caller.userId, gallery.id, args.card_share_link_id),
        "Sdílený odkaz této galerie nenalezen",
      );
    }
    const cardLinkId = args.card_share_link_id ?? gallery.eventLinkId;
    return jsonResult({
      weddingId: args.wedding_id,
      galleryId: gallery.id,
      cardShareLinkId: cardLinkId,
      next: cardLinkId
        ? "Na rozcestníku ji ukážeš přes wedding_set_gallery_listed s listed=true."
        : "Karta zatím nemá odkaz — vytvoř ho (share_link_create) a předej jako card_share_link_id.",
    });
  },
});

export const weddingSetGalleryListed = defineTool({
  name: "wedding_set_gallery_listed",
  title: "Ukázat galerii na rozcestníku",
  description:
    "Ukáže nebo skryje kartu galerie na rozcestníku svatby. Vlastní odkazy galerie tím nemění. Vrací, zda kartu hosté opravdu uvidí (musí být i zveřejněná a mít platný odkaz karty).",
  input: z.strictObject({ gallery_id: idInput("galerie"), listed: z.boolean() }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    const gallery = await ownedGallery(caller.userId, args.gallery_id);
    if (!gallery.eventId)
      throw new McpToolError("Galerie nepatří k žádné svatbě (wedding_add_gallery).");
    await owned(setGalleryListedFor(caller.userId, gallery.id, args.listed), GALLERY_NOT_FOUND);
    const blockers = [
      ...(gallery.status !== "PUBLISHED" ? ["galerie není zveřejněná (gallery_publish)"] : []),
      ...(!gallery.eventLinkId
        ? ["karta nemá odkaz (wedding_add_gallery s card_share_link_id)"]
        : []),
    ];
    return jsonResult({
      galleryId: gallery.id,
      listed: args.listed,
      ...(args.listed && blockers.length ? { hiddenBecause: blockers } : {}),
    });
  },
});

export const correctionSetResolved = defineTool({
  name: "correction_set_resolved",
  title: "Vyřídit připomínku",
  description:
    "Označí připomínku páru jako vyřízenou (pro pár je pak jen ke čtení), nebo ji znovu otevře (resolved=false).",
  input: z.strictObject({
    comment_id: idInput("připomínky (z corrections_list)"),
    resolved: z.boolean().default(true),
  }),
  access: "write-idempotent",
  handler: async (args, caller) => {
    await owned(
      setCorrectionResolvedFor(caller.userId, args.comment_id, args.resolved),
      "Připomínka nenalezena",
    );
    return jsonResult({ id: args.comment_id, resolved: args.resolved });
  },
});

export const WRITE_TOOLS = [
  galleryCreate,
  galleryUpdate,
  galleryPublish,
  galleryUnpublish,
  gallerySetCover,
  shareLinkCreate,
  shareLinkSetPermissions,
  weddingCreate,
  weddingUpdate,
  weddingAddGallery,
  weddingSetGalleryListed,
  correctionSetResolved,
];
