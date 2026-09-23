import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { resolveShareLink } from "@/lib/share-access";

/**
 * "Nepočítat mě", on the server (docs/GUEST-GALLERIES.md §6, §10).
 *
 * Until 2026-09-23 the footer's opt-out only forgot the `anonKey` in the
 * browser. The `Viewer` row stayed as it was — and once guests' names started
 * crediting their uploads, that meant a guest who opted out kept their name
 * on their photos for everyone, while no longer holding the key that would let
 * them change it. This marks the row for what the guest asked for before the
 * browser lets go of the key.
 *
 * Every row with this `anonKey`, not just this gallery's: the opt-out is
 * stored per browser, so the guest is already opted out of every gallery they
 * open here, and a name left on the server in another one would contradict
 * what the footer now tells them. It is the one place a viewer's rows are
 * addressed across galleries, and it only ever removes data.
 *
 * What stays: the photos (they belong to the album), and hearts and print
 * marks (the couple's print order is built from them). What goes: the name,
 * and with `optedOut` every route that would record something new refuses —
 * favourite, reaction, print, transfer — while activity, the viewer chips and
 * the digest already skip the row.
 */
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  // Same shape every other viewer route accepts: garbage is refused before it
  // reaches the (unindexed, see below) update.
  anonKey: z.uuid(),
});

export async function POST(request: Request, ctx: RouteContext<"/api/g/[token]/opt-out">) {
  const { token } = await ctx.params;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  // A live link is still required: the anonKey alone is not something this
  // server should act on from any caller at all.
  const access = await resolveShareLink(token);
  if (!access.ok) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // And the key has to have been used *through this link's gallery*. The
  // update below reaches every gallery the key was seen in; without this, any
  // live link would be a handle on rows in galleries its holder cannot open.
  // No row here means there is nothing this browser wrote to take back yet,
  // which is a success, not an error — the browser still forgets the key.
  const here = await prisma.viewer.findUnique({
    where: {
      galleryId_anonKey: { galleryId: access.shareLink.galleryId, anonKey: parsed.data.anonKey },
    },
    select: { id: true },
  });
  if (!here) return NextResponse.json({ ok: true, viewers: 0 });

  // No index leads with `anonKey` (the unique is galleryId-first), so this is
  // a scan of the viewer table. Fine for a click a handful of guests make;
  // revisit with an index if opt-out ever becomes routine.
  const { count } = await prisma.viewer.updateMany({
    where: { anonKey: parsed.data.anonKey },
    data: { optedOut: true, displayName: null },
  });

  return NextResponse.json({ ok: true, viewers: count });
}
