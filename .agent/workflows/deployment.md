---
description: Deployment rules and restrictions for the Rebase backend and all services
---

# ⛔ CRITICAL: DO NOT DEPLOY UNLESS I EXPLICITLY ASK YOU ⛔

**Do not deploy or run deployment commands unless the user explicitly asks you to in the current conversation.**

This applies to:
- `rebase cloud deploy` (any variant; the CLI has no top-level deploy command)
- `gcloud run deploy`
- `terraform apply` (any variant that deploys resources)
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
7. **Deploy** — execute deployment commands *only* when the user has explicitly asked you to in the current conversation.

## Rules for Deployment

1. **Do not deploy automatically** — never trigger a deploy command on your own.
2. **Obtain explicit user request** — only execute a deploy command if the user explicitly asks you to (e.g., "deploy everything" or "run the deploy command").
3. **Explain before executing** — before running a deployment command on behalf of the user, explain exactly what commands will be executed and what they will do.

## Summary

The agent should prepare and test code locally. **Deployment commands can only be executed by the agent if the user explicitly asks them to.**
