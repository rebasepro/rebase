---
title: "The docs gate was green, and six of the claims were still wrong"
description: "Checking that documentation names only symbols the code exports is mechanical, and we do it across 2952 code fences in six languages. Checking that its sentences are true is a different problem, and this is what we found when we went looking."
pubDate: 2026-09-07
authors: francesco
---

The bug that started this was a realtime API nobody had written. `channel.on("message", …)`, `channel.send(…)`, `channel.presence.track(…)` — a confident, plausible surface, documented in detail, machine-translated into all six locales, and absent from the code. Readers got a `TypeError` and the reasonable impression that realtime was broken.

So we built a gate. `pnpm verify:docs` now runs twenty-five stages over every documentation surface we ship, blocking in CI, and the baseline is zero. It reports things like *2952 code fences across 645 files* and *1052 snippets compiled against workspace source*, and when it says clean it means something.

This week it said clean, and six of the claims in those files were wrong anyway. That gap is the interesting part, so this post is about where it comes from.

## What you can check mechanically

Symbols are tractable. Four nets, and between them they close the original class properly:

**Named imports** are resolved through the TypeScript API against the real export surface, so re-exports across barrels work and `import { Foo } from "@rebasepro/server"` fails when `Foo` is not there. When another workspace package exports the name, the report says which — usually the actual fix.

**Subpath imports** are checked against each package's `exports` map. This is the one worth stealing. In-repo, `tsconfig` maps `@rebasepro/x/*` straight to source, so `@rebasepro/server/services/webhook-service` resolves perfectly on your machine and throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for everyone who installed from npm. A typechecker structurally cannot see that class, because the thing that is wrong is the packaging, not the types.

**Member access on typed receivers** — `channel.x` — counting public members only. Counting private ones would have let the original bug straight through, since `send` exists, privately.

**Snippet compilation.** Every fenced block in English and in the agent skills is compiled against workspace source. This is where call signatures get caught.

All four fail *quietly* if you let them, which is the thing to design against. Every accommodation a snippet checker makes — stubbing unresolvable modules, relaxing `noImplicitAny` — turns some code into `any`, and `any` accepts everything. A module that silently drops out of the program does not produce errors; it produces a clean run over unchecked code. `react` left ours twice. The second time it took fifteen generated pages with it, whose examples called `React.useState` with no import. So an unresolvable specifier is now a finding unless it is on an explicit allowlist, the hand-written `paths` targets are existence-checked, and a snippet the program never compiled is a finding rather than a skip.

## Where symbols stop being the problem

Two limits, both structural, and the second is the expensive one.

**A doc that declares a type instead of importing it is unverifiable by construction.** Here is what that looks like in practice. Our Studio skill contained this:

```typescript
interface AdminModeController {
    mode: "cms" | "studio" | "settings";
    setMode: (mode: "cms" | "studio" | "settings") => void;
}
```

That fence typechecks. It is a valid local interface declaration, and it compiles cleanly forever, because it is not referring to anything. The real union has two members. `"settings"` was removed precisely because nothing set it and nothing read it — the source comment says so — and an agent writing `setMode("settings")` gets a type error from a skill that told it, in bold, that these were the only valid values.

**Prose is not code.** A reference table naming a type, a sentence stating a default, a paragraph claiming an endpoint was removed — none of it is a fence and none of it is an import.

## The surface that rots fastest

It is the agent skills, consistently, and the reason is scheduling rather than care: docs get edited when a feature lands, and skills only get edited when someone reads them.

The stakes are also inverted from the usual assumption. A doc a person reads wrong costs them a minute — they try it, it fails, they go look at the source. A skill an agent reads wrong becomes code. Nearly every time our website docs and our skills disagreed, the docs were right.

So there is a second gate, `check-skill-claims.mjs`, for the claims rather than the symbols. It has one design rule, and it is the whole trick:

> Every rule reads its expected value out of the code rather than carrying a copy.

A rule that hardcodes `50` as the list limit is a second place for the number to be wrong. A rule that reads `DEFAULT_LIST_LIMIT` out of the driver goes red on the commit that changes the fact, which is the only moment anyone can act on it cheaply.

## This week's sweep

The point of a claim gate is that it only knows about facts somebody already found wrong. So the rule set has to be fed, adversarially, on purpose. Here is what a pass turned up against a green baseline.

**`PUT` was documented as gone.** The API skill said, emphatically: *"There is no `PUT`; it was an alias for the same handler and has been removed."* It is registered. It forwards to the same handler and answers with `Deprecation: true`, a decision the source comments at length about. The claim was not merely stale, it was inverted — and it hid the thing actually worth saying, which is that `PUT` performs a *partial* write despite what the verb promises.

**Every built-in email template was documented as Spanish.** *"The default welcome email template is in Spanish… override this template if you need a different language."* They are all English and have been for a while. An agent reading that adds a translation layer to fix a problem that does not exist.

**Eleven CLI subcommands documented as seven.** Two skills carried an enumeration of `rebase db` subcommands, one as a sentence and one as a table, both ending in a claim of completeness. `url`, `pull`, `stop` and `reset` were missing from both. An agent told those seven are "the whole list — anything else exits 1" reads `rebase db url` as a typo and invents its own way to find the connection string.

**And an index headed "every route the server mounts" was missing six of them**, including the entire bulk-write surface: `POST /bulk`, `PATCH /bulk`, `POST /bulk/delete`. Three routes that write, absent from the table whose first sentence claims to be exhaustive.

## Three things that went wrong in the gates themselves

This is the part I would want to read.

**A gate's blind spot is exactly the shape of its regex.** The route scanner matched `router.get("/path", …)` and required a literal `/` immediately after the quote. The data API registers everything as `` this.router.get(`${basePath}/count`, …) ``, because the prefix is a collection slug. Those paths start with `$`. So the surface that serves most of the traffic contributed *zero* routes to the completeness check, and the index quietly went stale in six places while the gate reported success. It now reads the generator's static tails — the prefix is unknowable, the tail is not — and it fails loudly if it ever stops matching anything, because "found nothing" and "nothing is wrong" must never render identically.

**The opt-out was a line range, and it swallowed a checkable claim next to an uncheckable one.** Both stale subcommand lists sat inside `<!-- docs-verify: ignore -->` blocks. They had to: the same paragraph names `rebase db studio` in order to say it does not exist, and the command checker would flag the name. The opt-out silenced that sentence and the enumeration in the same blockquote along with it. Silencing a true negative also silenced a false positive we wanted. The new rule reads the file whole and ignores those markers deliberately, because it is asking a question the opt-out was never meant to answer — *is this subcommand named anywhere on the page* — rather than *is this line runnable*.

**Markdown wraps, and regexes do not.** One completeness claim read "the driver accepts exactly / the subcommands above", split across two lines. A per-line test saw neither half.

## The only proof a gate works is breaking it

Every new rule got mutation-tested: put the wrong claim back, confirm the checker names it, restore. Five mutations, and **two did not fire on the first attempt**.

The subcommand rule accepted a bare `` `url` `` anywhere on the page as evidence that `rebase db url` was documented — and those pages discuss URLs constantly, so deleting the actual table row changed nothing. The wrapped sentence was the other. Both would have shipped as gates that check nothing and report green, which is worse than no gate, because a green check is something people rely on.

There is no substitute for this step. A checker that cannot find its spec must not conclude the spec is empty.

## The honest limits

`check-skill-claims.mjs` is a fixed rule set, not a sweep. Each individual rule is rot-proof, because each one derives its expected value from source. But the *set* only ever covers facts a human already caught being wrong once. New semantic drift needs a person to notice it, and then it is gated permanently.

That is the whole compounding mechanism, and it only works if the sweep ends properly. Finding a wrong claim and fixing it buys you one correct sentence. Finding a wrong claim, fixing it, and adding a derived rule buys you every future version of that sentence. The sweep above produced four new rules and one repaired route scanner; the next one starts from a higher floor.

The lesson underneath all of it is one we keep relearning in different clothes: **a verifier's passing output describes its glob, not your repo.** When a gate reports clean, the honest next question is not "are the docs correct" — it is "what did it look at, and what shape of wrongness can it see at all".

---

This comes out of a wider habit: we keep a catalogue of bug *classes* alongside the gates, because a gate added after an incident is scoped to that incident's exact shape, and a net built that way grows one hole at a time.

Rebase is an open-source backend-as-a-service for Postgres — REST, a typed SDK, auth, storage, realtime and row-level security over a database you own, with the admin panel that comes with it. It is [MIT-licensed on GitHub](https://github.com/rebasepro/rebase), and it is in public beta: the [compatibility page](/docs/compatibility) sets out exactly what may change and what may not.
