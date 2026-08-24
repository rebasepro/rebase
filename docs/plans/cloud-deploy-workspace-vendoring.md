# `cloud deploy` and locally-linked framework packages

**Status:** design note, not implemented. Written from the ~265-line
`scripts/prepare-deploy.mjs` that the dadaki app carries, which is the only
worked example of this problem we have.

## The problem

An app developed against a local checkout of this monorepo links every
`@rebasepro/*` package to an absolute path on one laptop:

```yaml
# pnpm-workspace.yaml
overrides:
  "@rebasepro/client": "link:/Users/someone/rebase/packages/client"
  "@rebasepro/server": "link:/Users/someone/rebase/packages/server"
  # …twenty-one of them
```

`rebase cloud deploy --source .` tars that tree and hands it to Kaniko, which
has neither the laptop nor the monorepo. Not one dependency resolves. So every
app in this situation writes a script that produces a staging copy standing on
its own, and each one reinvents the same four steps.

The consequence is not only duplicated effort. The **pinning discipline lives in
app-side convention**, which is why a framework version has already been bumped
silently under a deploy once: nothing in the tooling had an opinion about which
version was going out, so nothing noticed when it changed.

## What is generic, and what is not

From the dadaki script, step by step:

| Step | Generic? |
|---|---|
| 1. Copy the tree to a staging dir, minus `node_modules`/`.git`/`dist` | **Yes** — `createSourceTarball` already excludes most of this |
| 2. Vendor a sibling workspace package (`@dadaki/editor` + its prebuilt wasm) | **No** — arbitrary sibling checkouts, app-specific build artefacts |
| 3. Rewrite `link:` overrides for `@rebasepro/*` to a published version | **Yes** — this is the framework's own packages |
| 4. Write `.env.production`, deliberately omitting `VITE_API_URL` | **No** — app policy about its own origin |
| 5. Write a `Dockerfile` | **Mostly** — the shape is standard, the build order is per-app |
| 6. `pnpm install --lockfile-only` against the rewrite | **Yes** |

So the tool should absorb 1, 3, 5 and 6, and must not try to absorb 2 and 4.
An app that needs those keeps a script — a much shorter one that runs *before*
`cloud deploy`, rather than reimplementing deployment.

## Proposed behaviour

`rebase cloud deploy --source .` detects locally-linked framework packages and
handles them. Detection reads, in order: `pnpm-workspace.yaml` `overrides`,
`package.json` `pnpm.overrides` / `resolutions`, and direct dependency
specifiers — anything matching `@rebasepro/*` whose specifier is `link:`,
`file:` or `workspace:` and resolves outside the source directory.

When none are found, nothing changes. This must stay invisible to the common
case, which is an app that depends on published versions.

When some are found, the tarball is built from a staging copy — never the
working tree — with:

1. every matched specifier rewritten to one pinned version;
2. `pnpm install --lockfile-only` run **in the staging copy**, so a bad pin
   fails in seconds locally instead of after a ten-minute Kaniko round trip;
3. a generated `Dockerfile`, only if the app has none.

### `--framework-version`, and what it defaults to

One knob, three forms:

- `--framework-version 0.11.0` — an explicit pin.
- `--framework-version canary` — newest canary of the linked checkout's HEAD.
- omitted — **the version already resolved in the app's `node_modules`.**

The default is the important one. It is the version the developer actually ran
and tested against, which is the only version whose behaviour anybody has
observed. The dadaki script instead defaults to `0.9.1-canary.<sha of the local
rebase HEAD>`, which is a guess that a canary was published for that commit; when
it wasn't, the failure surfaces as an install error inside the builder.

The CLI already reads this version — `resolveFrameworkVersion` in
`packages/cli/src/commands/cloud/deploy.ts` walks up from the source directory
for `@rebasepro/server`, falling back to `@rebasepro/client` — and already sends
it to the control plane, which records it on the deployment row
(`deployments.framework_version`, migration 0023).

### The pinning discipline the tool can enforce and a script cannot

Three checks, all of which need to know things a per-app script does not:

**Uniform version.** Every `@rebasepro/*` in the tree must resolve to the same
version. Mixed eras are a real hazard — the dadaki script's own comment records
that the `latest` dist-tag pointed at an ancient `0.0.1` canary for several
packages while others were current, so a plain semver range mixed them. (All
packages reached `0.10.0` stable in July 2026, so this specific instance may be
stale; the check is what stops the next one.) Refuse rather than warn.

**Published-ness.** The pinned version must exist on the registry for every
package being rewritten, checked before the upload rather than discovered by
the builder.

**Drift from the last deploy.** With `framework_version` now recorded per
deployment, `deploy` can compare the version it is about to ship against the
last *successful* one and say so:

```
  @rebasepro/* 0.11.0  (last successful deploy used 0.10.0)
```

This is the check that addresses the silent bump directly, and it is the one
that cannot live app-side: it needs deployment history.

### The generated Dockerfile

Generated only when the app has no `Dockerfile`; an existing one is always
preferred and never overwritten. The standard shape is a two-stage
`node:22-alpine` build that installs `--frozen-lockfile`, builds, and runs as
uid 1000 — numerically, because Rebase Cloud's tenant pod spec pins
`runAsUser`/`runAsGroup` 1000 with `runAsNonRoot`, and the kubelet cannot verify
a non-numeric `USER` against `runAsNonRoot` and refuses to start the container.
That constraint is the platform's and belongs in the platform's tooling; the
dadaki Dockerfile carries a paragraph of comment explaining a rule it should
never have had to learn.

The per-app part is the build order (`pnpm --filter <config> build`, then
frontend, then backend). Inferring it is possible but guessy; the honest first
version prints the generated file and tells the app to commit and edit it if
the inference is wrong.

## The sharp edge: the lockfile

`pnpm install --lockfile-only` is the only step here that touches the network
and rewrites a file that matters.

**It must run in the staging copy and never in the user's tree.** This is not
theoretical: running `pnpm install` from a git worktree of this monorepo
silently pruned four importers and ~700 lines from the lockfile and exited 0,
because the gitignored `saas/` directory is a real workspace member that the
worktree does not have. A staging copy is structurally safe from that — it is a
different tree with a different member set, and it is thrown away — but the
implementation has to be deliberate about it, because the failure is silent.

Two open questions:

- **Offline / no-registry-access.** Resolution needs the network. Should a
  failure here be fatal, or fall back to shipping without a lockfile and letting
  the builder resolve (slower, non-reproducible, but not blocked)? Leaning
  fatal, with the fallback behind a flag.
- **Non-pnpm workspaces.** npm and yarn have the same problem with different
  spellings (`file:` deps, `resolutions`). The first version should detect and
  refuse them clearly rather than half-handle them.

## What this does not solve

An app with a linked *non-framework* package — dadaki's `@dadaki/editor`, with
its prebuilt wasm — still needs its own vendoring step. That is correct: the
framework has no business copying arbitrary sibling checkouts, and the
"which artefacts must be prebuilt" question has no general answer. What changes
is that such a script shrinks to the part that is genuinely about that app.
