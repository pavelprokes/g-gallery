"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Decision = "allow" | "deny";

/** The two buttons of the consent page; the server re-checks everything it is sent. */
export function McpConsentForm({ params }: { params: Record<string, string | undefined> }) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    setPending(decision);
    setError(null);
    try {
      const response = await fetch("/api/oauth/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, params }),
      });
      const body = (await response.json()) as { redirectTo?: string; error?: string };
      if (!response.ok || !body.redirectTo)
        throw new Error(body.error ?? "Povolení se nepodařilo uložit.");
      window.location.assign(body.redirectTo);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Povolení se nepodařilo uložit.");
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert tone="danger" role="alert">
          {error}
        </Alert>
      )}
      <div className="flex flex-col gap-3">
        <Button size="lg" disabled={pending !== null} onClick={() => void decide("allow")}>
          {pending === "allow" ? "Povoluji…" : "Povolit přístup"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={pending !== null}
          onClick={() => void decide("deny")}
        >
          {pending === "deny" ? "Zamítám…" : "Zamítnout"}
        </Button>
      </div>
    </div>
  );
}
