"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth-guard";
import { disconnect, instagramAccount } from "@/lib/instagram/connection";
import { GraphError, searchAudio, type InstagramAudio } from "@/lib/instagram/graph";

// Instagram's own music for a reel (docs/INSTAGRAM-AUDIO.md): the connected
// account searches the catalogue Meta offers it; the page takes a track's sound
// for its beat and, if asked, into the file. Nothing is published from here —
// the photographer uploads the video himself (Pavel, 2026-10-28). Every action
// re-verifies the session (invariant 3) and Zod-checks what the page sends.

export type ActionResult<T> =
  ({ ok: true } & T) | { ok: false; error: string; reconnect?: boolean };

async function account() {
  const session = await requireAdmin();
  return instagramAccount(session.user.id);
}

function failure(error: unknown): { ok: false; error: string; reconnect?: boolean } {
  if (error instanceof GraphError) {
    if (error.tokenInvalid) {
      return {
        ok: false,
        error: "Přihlášení k Instagramu vypršelo nebo bylo zrušené — připoj ho znovu.",
        reconnect: true,
      };
    }
    console.warn("[g-gallery/instagram]", error.code, error.subcode, error.message);
    return { ok: false, error: `Instagram odmítl: ${error.message}` };
  }
  throw error;
}

const NOT_CONNECTED = { ok: false as const, error: "Instagram není připojený.", reconnect: true };

export async function disconnectInstagram(): Promise<void> {
  const session = await requireAdmin();
  await disconnect(session.user.id);
  revalidatePath("/admin/reels");
}

const searchSchema = z.object({
  kind: z.enum(["music", "original_sound"]),
  query: z.string().max(100).optional(),
});

export async function searchInstagramAudio(
  input: z.input<typeof searchSchema>,
): Promise<ActionResult<{ items: InstagramAudio[] }>> {
  const { kind, query } = searchSchema.parse(input);
  const ig = await account();
  if (!ig) return NOT_CONNECTED;
  try {
    return { ok: true, items: await searchAudio(ig.igUserId, ig.token, { kind, query }) };
  } catch (error) {
    return failure(error);
  }
}
