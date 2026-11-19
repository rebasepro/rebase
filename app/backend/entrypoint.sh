#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx @stokaro/ptah-compat migrate apply --dir file://drizzle/migrations --url "$DATABASE_URL" 2>&1 || echo "⚠️ Migrations skipped or failed (non-fatal)"

echo "🚀 Starting Rebase backend..."
exec node dist/src/index.js
