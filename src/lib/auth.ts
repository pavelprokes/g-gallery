import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { prisma } from "@/lib/db";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  session: {
    // Signed cookie cache cuts per-request DB reads — and keeps sign-in state
    // briefly alive even if the free-tier DB is momentarily unreachable.
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  databaseHooks: {
    user: {
      create: {
        // Admin role is granted by email allowlist — clients also sign in with
        // Google, so the role must never default to admin.
        before: async (user) => ({
          data: {
            ...user,
            role: adminEmails.includes(user.email.toLowerCase()) ? "admin" : "user",
          },
        }),
      },
    },
  },
  // nextCookies must stay last (docs) so Server Actions can set cookies.
  plugins: [admin(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
