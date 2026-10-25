import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { McpConsentForm } from "@/components/admin/mcp-consent-form";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { parseAuthorizeRequest, pickAuthorizeParams } from "@/lib/mcp/oauth/authorization";
import { isLoopbackHost, publicOrigin } from "@/lib/mcp/oauth/config";

// "Connect Claude" consent (docs/MCP.md §Sign-in): the authorization endpoint
// of the MCP connection. Outside /admin, so proxy.ts does not gate it — the
// page checks the session itself and sends a stranger to the sign-in.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Připojit Claude",
  robots: { index: false, follow: false },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      data-admin-shell
      className="bg-admin-bg text-brand-ink flex min-h-dvh items-center justify-center px-4 py-10 antialiased scheme-light"
    >
      <Card as="section" aria-labelledby="consent-title" className="w-full max-w-md space-y-5">
        {children}
      </Card>
    </main>
  );
}

function Failure({ message }: { message: string }) {
  return (
    <Shell>
      <h1 id="consent-title" className="text-2xl font-semibold">
        Připojení se nepovedlo
      </h1>
      <Alert tone="danger">{message}</Alert>
      <p className="text-admin-muted text-sm">
        Zavřete toto okno a spusťte připojení v Claude znovu.
      </p>
    </Shell>
  );
}

export default async function AuthorizePage(props: PageProps<"/oauth/authorize">) {
  const query = await props.searchParams;
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  const params = pickAuthorizeParams(query);
  if (!session) {
    const back = `/oauth/authorize?${new URLSearchParams(params as Record<string, string>).toString()}`;
    redirect(`/sign-in?next=${encodeURIComponent(back)}`);
  }
  if (session.user.role !== "admin") {
    return (
      <Failure
        message={`Účet ${session.user.email} nespravuje galerie. Přihlaste se účtem fotografa.`}
      />
    );
  }

  const parsed = await parseAuthorizeRequest(params, publicOrigin(requestHeaders));
  if (!parsed.ok) {
    if (parsed.redirectTo) redirect(parsed.redirectTo);
    return <Failure message={parsed.message} />;
  }

  const { client, redirectUri } = parsed.request;
  const returnHost = new URL(redirectUri).hostname;
  const toThisComputer = isLoopbackHost(returnHost);

  return (
    <Shell>
      <div>
        <h1 id="consent-title" className="text-2xl font-semibold">
          Připojit {client.clientName}
        </h1>
        <p className="text-admin-muted mt-1.5 text-sm">
          Aplikace <strong>{client.clientName}</strong> z <strong>{client.host}</strong> chce
          pracovat s vašimi galeriemi za vás.
        </p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-admin-muted">Účet</dt>
        <dd className="break-all">{session.user.email}</dd>
        <dt className="text-admin-muted">Smí</dt>
        <dd>
          číst galerie, svatby, fotky a statistiky; zakládat galerie, svatby a odkazy a upravovat
          je. Mazat ani nahrávat nesmí.
        </dd>
        <dt className="text-admin-muted">Návrat na</dt>
        <dd className="break-all">
          {returnHost}
          {toThisComputer && " (aplikace na tomto počítači)"}
        </dd>
      </dl>
      <Alert tone="warning">
        {toThisComputer
          ? "Povolte jen tehdy, když jste připojení právě spustili v Claude Code na tomto počítači. Adresu localhost může použít kterýkoli program v počítači."
          : "Povolte jen tehdy, když jste připojení právě sami spustili v Claude. Odkaz na tuto stránku od někoho jiného zamítněte — získal by přístup ke galeriím za vás."}
      </Alert>
      <McpConsentForm params={params} />
      <p className="text-admin-muted text-xs">
        Přístup se sám prodlužuje, dokud ho Claude aspoň jednou za 30 dní použije, nejdéle 90 dní.
        Odebrání role správce ho zruší hned.
      </p>
    </Shell>
  );
}
