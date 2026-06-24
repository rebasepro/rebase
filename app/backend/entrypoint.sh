#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx @ariga/atlas migrate apply --dir file://drizzle --url "$DATABASE_URL" 2>&1 || echo "⚠️ Migrations skipped or failed (non-fatal)"

echo "🚀 Starting Rebase backend..."
exec node dist/backend/src/index.js
