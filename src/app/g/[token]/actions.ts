"use server";

import { verifySharePassword } from "@/lib/share-access";
import { setUnlockCookie } from "@/lib/share-unlock";

export interface UnlockState {
  error?: string;
}

/**
 * Unlock a password-protected share link. Deliberately vague on failure so the
 * form can't be used to probe which links exist — this also covers the
 * rate-limited-lockout case (`verifySharePassword`) with the same message,
 * so a failed attempt never reveals whether the link is now locked out.
 */
export async function unlockShareLink(
  _previous: UnlockState,
  formData: FormData,
): Promise<UnlockState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!token || !password) return { error: "Zadej heslo." };

  const result = await verifySharePassword(token, password);
  if (!result.ok) return { error: "Nesprávné heslo. Zkus to prosím později." };

  await setUnlockCookie(result.shareLinkId, result.passwordHash);
  return {};
}
