#!/bin/sh
set -e

echo "🔄 Running database push..."
npx drizzle-kit push --force --config=drizzle.config.ts 2>&1 || echo "⚠️ Push failed (non-fatal)"
echo "🚀 Starting Rebase backend..."
exec node dist/app/backend/src/index.js
