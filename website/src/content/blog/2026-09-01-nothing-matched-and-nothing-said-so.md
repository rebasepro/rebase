---
title: "Nothing matched, and nothing said so"
description: "Three consecutive releases shipped without one of their packages, and every job was green. The cause was a filter that selected nothing — a failure mode shared by pnpm filters, Atlas excludes, grep, and an empty test matrix. Here is why selection is silent by construction, and what we changed."
pubDate: 2026-09-01
authors: francesco
draft: true
---

Three consecutive releases of Rebase went out without one of their packages. Not a broken build, not a failed upload — the package was simply never bumped and never published, while every job in the pipeline reported success.

Here is the whole cause. On 24 August a directory moved: `rebase-agent-skills/` became `tooling/rebase-agent-skills/`. The release workflow named its publishable packages twice, as literal paths. The shell loops were updated. Four `pnpm --filter './rebase-agent-skills'` invocations were not.

pnpm treats a filter that matches nothing as a warning. It prints `No projects matched the filters "…"`, exits 0, and gets on with the filters that did match. So the version bump ran for `packages/*`, silently skipped the one package that had moved, and the step went green — because from pnpm's point of view, nothing had gone wrong. It was asked to operate on a set. The set was empty. It operated on it perfectly.

## The part that was worse than not publishing

`packages/cli` depends on that package as `workspace:*`, and pnpm resolves `workspace:*` at publish time against *the depended-on package's own manifest*. The skills package was still sitting at 0.16.0, so every published CLI carried a hard `"@rebasepro/agent-skills": "0.16.0"` — a pin nobody wrote, four versions behind, in three separate releases.

Which means `rebase skills install` had been writing the 0.16.0 skill set for a week. Every agent skill authored or edited in that window reached no user at all.

Then CI ran against the fix, and a fourth copy of the list surfaced — the one that could not be repaired by correcting a path. Our registry-install end-to-end test builds its set with `readdirSync("packages")`. It structurally could not see a package under `tooling/`. So the package was never packed into the local registry, the CLI's dependency on it was never rewritten to a local tarball, and the test fetched it **from the public npm registry** instead. It passed. It passed because 0.16.0 — the version this very bug had stranded there — happened to exist and happened to install.

An end-to-end test that reaches the real registry for your own package is not testing the tree it was given. It is testing the internet.

## Selection is a silent operation

I wrote in an [earlier post](/blog/2026-08-23-security-that-does-not-depend-on-remembering/) that absence has no stack trace. This is the same observation pointed at build tooling, and it is sharper there, because build tools are *made of* selection.

A filter, a glob, an exclude pattern, a `readdir`, a grep, a test matrix — each takes a set and narrows it. And every one of them has the same structural blind spot: **an empty result and a completed job are the same event.** The tool has no way to tell "you asked for something that does not exist" from "there was nothing here to do", because both are, mechanically, zero items processed. So it does the only defensible thing and returns success.

Once you are looking for this shape you find it everywhere. Every one of the following cost us real time this summer:

**`pnpm --filter <path>` on a moved directory.** Warning, exit 0. Three unpublished releases.

**`readdirSync("packages")` for a package that lives in `tooling/`.** No error is even possible — the directory it read was there and did contain files.

**An Atlas `--exclude` pattern in the two-part form.** `--exclude` wants `schema.table.object`. Give it `posts.search_vector` and Atlas reads it as a *table* called `search_vector` in a *schema* called `posts`, matches nothing, and reports no error. The exclusion you wrote to protect a column silently protects nothing, and the next `db push` plans a `DROP COLUMN` for it.

**The same pattern in `atlas.hcl`.** An `env` block's `exclude = [...]` is accepted by `atlas migrate diff` and then ignored. Measured: it still wrote the drop.

**`grep`, when `grep` is not grep.** On this machine `grep` is a shell function, and recursive runs respect `.gitignore` like ripgrep does. `grep -rn '@rebasepro/admin' .` returned nothing while `grep -c '@rebasepro/admin' AGENT.md` returned 2 — because `AGENT.md` is gitignored. A sweep that skips ignored files reads *exactly* like a clean sweep. It cost two wrong answers in one session.

**`grep`, when the file tests as binary.** `packages/client/src/offline.ts` held a sentinel written with a raw NUL byte. That made the file binary, so every repo-wide grep skipped all 1,700 of its lines in silence — including while we were auditing that exact file. A repo-wide grep returning no matches is not evidence of absence. It can mean the file was never opened.

**`describe.each([])`.** Registers no tests and reports green. Our upgrade suite reads its fixtures from a snapshot directory; point it at an empty directory and it becomes a suite that passes instantly, forever, having verified that migrations work by not running any.

Seven mechanisms, one shape. In none of them did anything fail. In all of them, the report was indistinguishable from the report you get when everything is fine.

## What we actually changed

The tempting fix is to correct the path. That is the fix that guarantees a rerun, because the next directory move invalidates the next string.

The rule we landed on instead: **a release must not enumerate its own contents.**

`tooling/scripts/publishable-packages.mjs` derives the set from `pnpm-workspace.yaml` — every member that is not `private`. It is the single derivation, used by the workflow, by `release.sh`, and by the workspace-protocol validator, all three of which had been holding their own copy of the list. Publishing now passes no `--filter` at all, because `pnpm -r publish` already publishes exactly the non-private workspace members wherever they happen to live. There is nothing left for a directory move to invalidate.

Three more habits came out of it, and they generalise past this repo:

**Make no-match fatal at the boundary you control.** The registry-install test now packs the derived set, and a first-party package missing from it throws rather than warns. You usually cannot change how pnpm or Atlas treat an empty selection. You can change what your own code does when it gets a suspiciously empty answer back.

**Put a vacuity floor under any data-driven test matrix.** `upgrade-e2e.test.ts` asserts `snapshots.length >= MINIMUM_SNAPSHOTS` before `describe.each` ever sees the array. It is two lines and it is the difference between a suite that verifies upgrades and a suite that verifies nothing at exactly the same speed.

**Run the guard on every PR, not at release time.** `pnpm check:publishable-set` fails when publishable packages fall out of version lockstep (the symptom), when any release file enumerates packages by hand (the cause), when a publishable `@rebasepro/*` package sits outside the workspace globs where nothing would see it, when a package declares no `files`, or when its `repository.directory` no longer matches where it lives — which the same August move had also left stale. A check that only runs during a release is a check you discover during a release.

## The question that would have caught it

Every check in that pipeline was correct. The version validator confirmed the versions matched. The pack step confirmed each tarball was well formed. The publish step confirmed each upload succeeded.

All of them asked: *is what I found correct?*

None of them asked: *did I find everything?*

That is the whole distinction, and it is worth keeping as a literal question to ask of any script that starts by selecting things. The first question is answered by validating items. The second can only be answered by comparing your set against an independent derivation of what the set should be — which is why the fix was a derivation and not a longer list.

## The honest limits

A derived set is not automatically a correct set. Ours now depends on `pnpm-workspace.yaml` and on the `private` flag being right; get either wrong and you have moved the single point of failure rather than removed it. The difference is that both of those are declarations a human reads on purpose, not a path string buried in the fourth argument of a shell loop.

And fatal-on-empty has false positives. Plenty of filters legitimately match nothing — an optional cleanup step, a conditional glob, a test tag nobody used this run. Turning every empty selection into an error would be unlivable. The judgement is about which selections carry a *claim*: "these are the packages we publish" is a claim about completeness, and it should be impossible to satisfy vacuously. "Delete any leftover temp files" is not.

The general form, though, holds up better than I expected when I went looking for counterexamples. If a step in your build narrows a set, and the narrowing is written as a literal string, then somewhere in your future is a rename that turns it into a no-op — and the pipeline will go green, and it will keep going green, for as long as it takes someone to notice by other means.

We noticed by other means after three releases.

---

Rebase is an open-source backend-as-a-service for Postgres — REST, a typed SDK, auth, storage, realtime and row-level security over a database you own, with an admin panel when you want one. It is [MIT-licensed on GitHub](https://github.com/rebasepro/rebase), and it is in public beta: the [compatibility page](/docs/compatibility) sets out exactly what may change and what may not.
