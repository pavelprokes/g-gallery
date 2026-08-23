"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Clears the unread badge in the shell after this page marks the feed read.
 *
 * The badge lives in the admin layout, and the App Router does not re-render a
 * shared layout on a client-side navigation between two routes that share it —
 * so arriving here from /admin would mark the feed read on the server while the
 * badge in the top bar kept showing the old count until a hard reload.
 * `router.refresh()` refetches the tree including the layout. Once per mount:
 * refresh re-renders this component's parent, and an unguarded call would loop.
 */
export function FeedReadSync() {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    router.refresh();
  }, [router]);

  return null;
}
