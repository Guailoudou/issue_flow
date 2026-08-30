#!/bin/sh
set -eu

cd /app/apps/api

pnpm exec prisma migrate deploy
exec pnpm exec tsx src/server.ts

