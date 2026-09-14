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

## The preflight gate

`pnpm harness:preflight` runs `tooling/scripts/harness/deploy/preflight.mjs` before
a deploy. It catches:

- a lockfile regenerated in a worktree
- a drizzle migration that will be silently skipped
- a `securityRules` edit with no migration behind it
- `saas/config` not compiling
- a deploy aimed at a control plane that does not serve production

In the maintainers' agent setup, a `PreToolUse` hook runs the same checks before
anything that deploys: `gcloud run deploy`, `gcloud builds submit`,
`kubectl apply/set image/rollout/delete`, `terraform apply`, `rebase cloud deploy`
and `pnpm deploy:*`. A failing check blocks the command. Run it yourself before
you start, so the hook reads a stamp instead of re-running the checks inline. What
each check means, and how to add one, is in `tooling/scripts/harness/README.md`.

## Releasing: never without explicit consent

**Never publish, release or tag any Rebase package without the user's explicit,
in-the-moment consent for that specific release.** This rule is absolute. None of
these satisfy it:

- a standing instruction
- "finish this and ship it"
- a task list that ends in "release"
- a green test suite
- an earlier approval of a different release

Choosing the version number is also the user's call.

Unless asked for that exact release, never run:

- `npm publish`, `pnpm publish` or `pnpm -r publish`
- `gh workflow run publish.yml` on any channel, **including a dry run**
- `git tag v*`, or pushing a tag
- the version-bump scripts
- anything that pushes an image to a registry under `rebasepro/`

Pushing to `main` runs CI only. Canaries are published by
`gh workflow run publish.yml -f channel=canary`, like any other release.

The reason it is absolute: a published npm version cannot be unpublished, a pushed
tag is already on the branch, and every scaffolded project pulls
`rebasepro/server:<version>`. None of it can be undone.

**What to do instead:** prepare everything up to the irreversible step. Write the
CHANGELOG, run the gates, get the tree green. Then stop, report what is ready,
and name the exact command that would publish it.

If `[Unreleased]` has a `### Breaking` section, preparing includes the upgrade
page. Rename `upgrading/<from>-to-next.mdx` and its five translations to
`<from>-to-<minor being cut>.mdx`, and write them as that release's page. The
release makes its other docs edits itself (`tooling/scripts/release-docs.mjs`:
pins, "Since" badges, `NOT_NEW`, translation stamps), then runs
`verify:docs:strict` before it publishes. An upgrade page still named
`-to-next` stops the release there.

## Summary

The agent should prepare and test code locally. **Deployment commands can only be executed by the agent if the user explicitly asks them to.**
