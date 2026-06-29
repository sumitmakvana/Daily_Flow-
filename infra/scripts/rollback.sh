#!/usr/bin/env bash
# Rollback. Flips the app back to Supabase. Local stack stays running so
# you can investigate, but the app no longer points at it.
set -euo pipefail

cat <<'EOF'
Rollback steps:

1. In your app deployment environment, unset:
     BACKEND_MODE
     BACKEND_JWT_SECRET
   And restore the original SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY /
   VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY values.

2. Redeploy the app.

3. In Google Cloud Console, re-add the Supabase OAuth redirect URI:
     https://<project>.supabase.co/auth/v1/callback

4. Verify sign-in + a write against Supabase (still source of truth
   during the 7-day rollback window).

5. Leave the self-hosted stack up for forensics, then `docker compose down`
   once the team has confirmed Supabase is healthy.
EOF
