#!/bin/sh
set -e

echo "🔄 Running database migrations..."
npx drizzle-kit migrate --config=drizzle.config.ts 2>&1 || echo "⚠️ Migrations skipped or failed (non-fatal)"

echo "🚀 Starting Rebase backend..."
exec node dist/app/backend/src/index.js
