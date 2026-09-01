#!/bin/sh
set -eu

cd /app/apps/api

case "${DATABASE_URL:-}" in
  file:*)
    database_path=${DATABASE_URL#file:}
    database_path=${database_path%%\?*}
    case "$database_path" in
      /*) ;;
      *) database_path="/app/apps/api/prisma/$database_path" ;;
    esac
    if [ ! -e "$database_path" ]; then
      mkdir -p "$(dirname "$database_path")"
      : > "$database_path"
    fi
    ;;
esac

pnpm exec prisma migrate deploy
exec pnpm exec tsx src/server.ts
