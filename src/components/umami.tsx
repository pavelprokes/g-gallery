import Script from "next/script";
import { SITE_ORIGIN } from "@/lib/site-url";
import { UMAMI_SCRIPT, UMAMI_URL, UMAMI_WEBSITE_ID, umamiEnabled } from "@/lib/umami-config";

// Umami resolves `data-before-send` as a global function name at send time, so
// this only has to exist by the first pageview. It redacts share tokens
// (CLAUDE.md invariant #7). Self-contained on purpose (it is shipped as a
// string) — keep the regex in step with scrubPath in src/lib/umami-scrub.ts.
const BEFORE_SEND = `window.umamiScrub=function(t,p){var s=function(u){return u.split(/[?#]/)[0].replace(/^\\/(api\\/)?(g|s)\\/[A-Za-z0-9_-]{16,}/,"/$1$2/[token]")};if(p&&typeof p.url==="string")p.url=s(p.url);if(p&&typeof p.referrer==="string"){try{var r=new URL(p.referrer);if(r.origin===location.origin)p.referrer=s(r.pathname)}catch(e){}}return p}`;

export function UmamiScript() {
  if (!umamiEnabled()) return null;
  return (
    <>
      <Script id="umami-scrub" strategy="afterInteractive">
        {BEFORE_SEND}
      </Script>
      <Script
        src={`${UMAMI_URL}/${UMAMI_SCRIPT}`}
        data-website-id={UMAMI_WEBSITE_ID}
        data-domains={new URL(SITE_ORIGIN).hostname}
        data-before-send="umamiScrub"
        strategy="afterInteractive"
      />
    </>
  );
}
