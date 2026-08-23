/**
 * What a revoked or expired link shows. Deliberately identical for both:
 * telling a visitor which one it was would let anyone holding an old link
 * probe whether it was cut off deliberately or simply ran out.
 */
export function ShareLinkDead({ what = "Odkaz" }: { what?: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-xl font-semibold">{what} už není platný</h1>
        <p className="mt-2 text-sm text-neutral-500">Požádej fotografa o nový odkaz na galerii.</p>
      </div>
    </main>
  );
}
