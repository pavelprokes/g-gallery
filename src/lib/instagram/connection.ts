import "server-only";

// The connected Instagram account (docs/INSTAGRAM-PUBLISH.md §3.1): made from
// a sign-in's code, kept with its tokens encrypted, read back with the one
// token the Instagram calls accept.

import { prisma } from "@/lib/db";
import { decryptToken, encryptToken } from "@/lib/token-cipher";
import {
  exchangeCode,
  GraphError,
  instagramProfile,
  longLivedToken,
  pagesOf,
  type PageWithInstagram,
} from "@/lib/instagram/graph";

export type TokenKind = "page" | "user";

export interface InstagramAccount {
  igUserId: string;
  igUsername: string;
  pageName: string;
  /** The token every Instagram call uses. */
  token: string;
  /** When the person has to sign in again — null when nothing expires. */
  expiresAt: Date | null;
}

/** What the admin shows; never a token. */
export interface InstagramStatus {
  username: string;
  pageName: string;
  expiresAt: string | null;
}

export class ConnectError extends Error {
  constructor(readonly reason: "no-cipher" | "no-instagram" | "token-rejected" | "graph") {
    super(reason);
  }
}

/**
 * The sign-in's code → long-lived user token → the first Page with a linked
 * Instagram account (the photographer manages one) → which token Instagram
 * accepts, by asking for the account's own profile with each.
 */
export async function connectFromCode(
  ownerId: string,
  code: string,
  redirectUri: string,
): Promise<InstagramStatus> {
  const short = await exchangeCode(code, redirectUri);
  const long = await longLivedToken(short.access_token);
  const pages = await pagesOf(long.access_token);
  const page = pages.find((p) => p.instagram_business_account);
  if (!page?.instagram_business_account) throw new ConnectError("no-instagram");

  const { kind, username } = await probeToken(page, long.access_token);
  const userTokenCipher = encryptToken(long.access_token);
  const pageTokenCipher = page.access_token ? encryptToken(page.access_token) : null;
  if (!userTokenCipher || (page.access_token && !pageTokenCipher)) {
    throw new ConnectError("no-cipher");
  }
  const expiresAt =
    long.expires_in && long.expires_in > 0 ? new Date(Date.now() + long.expires_in * 1000) : null;
  const data = {
    igUserId: page.instagram_business_account.id,
    igUsername: username,
    pageId: page.id,
    pageName: page.name,
    userTokenCipher,
    userTokenExpiresAt: expiresAt,
    pageTokenCipher,
    tokenKind: kind,
  };
  await prisma.instagramConnection.upsert({
    where: { ownerId },
    create: { ownerId, ...data },
    update: data,
  });
  return {
    username,
    pageName: page.name,
    expiresAt: kind === "user" && expiresAt ? expiresAt.toISOString() : null,
  };
}

/** The Page's token first — it does not expire — then the user's. */
async function probeToken(
  page: PageWithInstagram,
  userToken: string,
): Promise<{ kind: TokenKind; username: string }> {
  const igUserId = page.instagram_business_account!.id;
  const tries: [TokenKind, string | undefined][] = [
    ["page", page.access_token],
    ["user", userToken],
  ];
  for (const [kind, token] of tries) {
    if (!token) continue;
    try {
      const profile = await instagramProfile(igUserId, token);
      return { kind, username: profile.username };
    } catch (error) {
      if (!(error instanceof GraphError)) throw error;
    }
  }
  throw new ConnectError("token-rejected");
}

export async function instagramAccount(ownerId: string): Promise<InstagramAccount | null> {
  const row = await prisma.instagramConnection.findUnique({ where: { ownerId } });
  if (!row) return null;
  const token = decryptToken(row.tokenKind === "page" ? row.pageTokenCipher : row.userTokenCipher);
  if (!token) return null;
  return {
    igUserId: row.igUserId,
    igUsername: row.igUsername,
    pageName: row.pageName,
    token,
    expiresAt: row.tokenKind === "user" ? row.userTokenExpiresAt : null,
  };
}

export async function instagramStatus(ownerId: string): Promise<InstagramStatus | null> {
  const row = await prisma.instagramConnection.findUnique({
    where: { ownerId },
    select: { igUsername: true, pageName: true, tokenKind: true, userTokenExpiresAt: true },
  });
  if (!row) return null;
  return {
    username: row.igUsername,
    pageName: row.pageName,
    expiresAt:
      row.tokenKind === "user" && row.userTokenExpiresAt
        ? row.userTokenExpiresAt.toISOString()
        : null,
  };
}

export async function disconnect(ownerId: string): Promise<void> {
  await prisma.instagramConnection.deleteMany({ where: { ownerId } });
}
