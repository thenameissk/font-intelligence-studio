#!/usr/bin/env bash
#
# Creates the GitHub repository and pushes, so Render has something to
# deploy from.
#
# Run `gh auth login` first — that step needs your GitHub account and is
# yours to do.
set -euo pipefail

REPO_NAME="${1:-font-intelligence-studio}"
VISIBILITY="${2:-private}"

cd "$(dirname "$0")/.."

GH="$(command -v gh || echo "$HOME/.local/bin/gh")"
if [ ! -x "$GH" ]; then
  echo "The GitHub CLI is not installed. See https://cli.github.com" >&2
  exit 1
fi

if ! "$GH" auth status >/dev/null 2>&1; then
  cat >&2 <<'MSG'
Not signed in to GitHub.

Run this once, then run this script again:

    gh auth login

Choose GitHub.com, HTTPS, and "Login with a web browser".
MSG
  exit 1
fi

echo "Signed in as: $("$GH" api user --jq .login)"

if git remote get-url origin >/dev/null 2>&1; then
  echo "Remote 'origin' already set to: $(git remote get-url origin)"
else
  echo "Creating $VISIBILITY repository '$REPO_NAME'…"
  "$GH" repo create "$REPO_NAME" \
    --"$VISIBILITY" \
    --source=. \
    --remote=origin \
    --description "Browser-based font analysis and glyph editing, with a Django server."
fi

echo "Pushing…"
git push -u origin main

URL="$("$GH" repo view --json url --jq .url)"
cat <<MSG

Pushed: $URL

Next, and only you can do these:

  1. Object storage for uploaded fonts — Cloudflare R2 (free tier is ample).
     Create a private bucket and an "Object Read & Write" API token.
     You need four values: bucket name, access key id, secret access key,
     and the endpoint https://<ACCOUNT_ID>.r2.cloudflarestorage.com
     Full walkthrough: RENDER.md, section 1.

  2. Render — dashboard.render.com → New → Blueprint → pick this repo.
     It reads render.yaml, creates the web service and Postgres, and
     prompts for the four values above.

  3. Once live, open the service's Shell tab:
        python manage.py createsuperuser
     Then sign in at https://<your-service>.onrender.com/studio/

MSG
