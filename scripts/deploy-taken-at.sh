#!/bin/zsh
# One-shot production rollout for the takenAt timeline (capture-order sorting).
#
#   ./scripts/deploy-taken-at.sh
#
# Order matters (CLAUDE.md §Deploying): the migration and backfill run against
# production BEFORE the code lands on main, so the deployed code never queries
# a column that does not exist yet. After this finishes cleanly: `git push`.
#
# Idempotent end to end — migrate deploy skips applied migrations, and the
# backfill only rewrites rows whose takenAt differs from the EXIF value.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.production.local ]]; then
  echo "missing .env.production.local (production DIRECT_URL lives there)" >&2
  exit 1
fi

# Exported shell vars win over anything dotenv loads from .env inside the
# tools, so this cleanly retargets Prisma and the backfill at production.
set -a
source .env.production.local
set +a

echo "→ target DB host: $(echo "$DIRECT_URL" | sed -E 's|.*@([^:/?]+).*|\1|')"
echo
echo "→ prisma migrate status (before)"
pnpm exec prisma migrate status || true

echo
echo "→ prisma migrate deploy"
pnpm exec prisma migrate deploy

echo
echo "→ backfill takenAt from EXIF (reads originals' headers off the CDN)"
pnpm backfill:taken-at

echo
echo "✓ done — now push the code: git push"
