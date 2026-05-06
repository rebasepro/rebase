---
description: Deployment rules and restrictions for the Rebase backend and all services
---

# ⛔ CRITICAL: NEVER DEPLOY TO PRODUCTION ⛔

**Under NO circumstances should any agent deploy to production.** This includes:

- `rebase deploy` (any variant)
- `firebase deploy` (any variant)
- `gcloud functions deploy`
- `gcloud run deploy`
- Any command that pushes code, functions, or configuration to a live environment
- Any command targeting `production`, `prod`, or `staging` environments
- Any command using service account keys to modify live infrastructure

## What you CAN do

1. **Edit source code** — make changes to files locally
2. **Build** — run `pnpm run build` or `tsc` to verify compilation
3. **Run tests** — run `pnpm test` or equivalent
4. **Run local dev server** — `pnpm dev` is fine
5. **Check logs** — read-only log queries are fine
6. **List resources** — read-only commands are fine

## What you MUST NOT do

1. **NEVER run `rebase deploy`** — not even with `--env dev`
2. **NEVER run `firebase deploy`** — not even with `--only functions:specificFunction`
3. **NEVER run deploy scripts** — e.g. `pnpm run deploy:prod`, `pnpm run deploy:staging`
4. **NEVER modify live infrastructure** — no creating, updating, or deleting cloud resources
5. **NEVER bypass predeploy hooks** — do not modify configuration to skip build steps for deployment purposes
6. **NEVER approve deployment prompts** — if a command asks "Would you like to proceed with deployment?", the answer is always NO

## If the user asks you to deploy

- **Provide the exact command** they should run themselves
- **Explain what the command will do** before they run it
- **Never run it on their behalf** — unless they explicitly ask you to.

## Summary

The agent's role is to write code, debug, analyze logs, and prepare changes. **Deployment is always the user's responsibility.**
