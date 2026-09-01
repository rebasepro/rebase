---
title: "Every check in our CI is a post-mortem, and that is the problem"
description: "A gate added after an incident is scoped to that incident's exact shape, so the net grows one hole at a time. We keep a second document instead: fifty named bug classes, the sweep that finds each one, and a dated log of what every sweep turned up — including what came back clean."
pubDate: 2026-09-15
authors: francesco
---

Open `.github/workflows/verify.yml` in the Rebase repo and every gate has a comment above it explaining why it exists. Each of those comments is a post-mortem. Fourteen gates, fourteen bugs that had already shipped.

That is a healthy reflex as far as it goes — a bug that becomes a gate cannot come back. But it is strictly reactive, and reactive nets have a specific failure mode: each gate is added *after* an incident and scoped to that incident's exact shape, so the net grows one hole at a time, and the next bug falls through a hole nobody has patched yet. You end up with a very thorough defence against things that have already happened once.

So we keep a second document. `docs/bug-classes.md` is currently fifty entries long. Each one names a *shape* a bug can take, the sweep that finds its siblings, and a dated log of what the last sweep turned up.

## The unit of work is the class, not the bug

The discipline is five steps, and the first is the one people skip:

1. Name the class. Not "the delete route returns 204 when it should 403" — the class is *a refusal the database expresses as a number*.
2. Sweep for siblings, with a query you write down.
3. Fix the class, not the instance.
4. Gate the class, not the input.
5. **Prove the gate fails**, by breaking the fix on purpose.

Then log the sweep — including what came back clean, because that is the part that stops the next person repeating the same search six weeks later.

Almost every sweep we have run converted one fix into three to five. Not because we are unusually buggy, but because bugs arrive in shapes, and a shape that fit once fits again somewhere you were not looking.

## Some of the fifty

A few entries, chosen because they generalise past this codebase.

**Starting state.** Every test suite here builds its own fixture, which means every suite starts from a database the current code just created. That is one of three states a real deployment is in: *empty* (provisioned, no rows), *fresh* (provisioned and seeded), and *aged* (created by an older release, then upgraded).

Empty is where first-run logic lives, and it is invisible to a normal fixture from both directions at once — a fixture that seeds a user never enters the bootstrap window, and one that seeds nothing never registers. Our first-admin dead end lived there for months. Aged is where migrations live, and it is unreachable *by construction*: code that writes the new shape cannot produce the old one. Three separate outages lived there.

The sweep: for any branch on the existence or count of a resource, ask what the zero side does, and whether any test ever reaches it. And watch specifically for a zero-state branch that *opens* access rather than closing it. An empty permission list must mean no permissions, never all permissions.

**One predicate, several implementations.** An endpoint advertises a capability and a route enforces it, each computing the same rule independently. They agree the day they are written and diverge on the first change, and the symptom is a user staring at a form that can only ever 403.

`registrationEnabled` had drifted across *three* implementations here. Two had been fixed for the empty-database case. The third had never had the kill switch at all — and the third was the live one, because `init.ts` registers `GET /auth/config` directly and mounts the auth router afterwards, so Hono resolves the direct registration first and the router's copy never runs.

The fix shape matters more than the fix: do not correct the outlier. Extract the predicate, route every caller through it, then pin *agreement* rather than behaviour — a test asserting that what `/auth/config` advertises is what `/auth/register` actually does, across the whole flag matrix. Any term added later is covered automatically, which a test written against either endpoint alone is not.

**Safety nets that swallow their own failures.** `ensureAuthTablesExist` wraps its migrations in `try { … } catch { logger.warn() }` and continues, deliberately — a limping boot beats a crash loop. The cost is that a migration which throws raises nothing for a test to catch, so **"it booted" proves nothing at all.**

Same shape wherever a `catch` logs and continues, and wherever a step may be skipped. `rls-check` had a "no Docker, skip" escape hatch that reported success for a scan that never ran, which is why CI now sets `RLS_CHECK_REQUIRE_DOCKER=1`. The sweep question is exact: for each one, *what test would fail if the guarded work silently did nothing?*

**A completion check that the state before the change already passes.** My favourite of the fifty, because it is so plausible. Something is replaced — a Deployment's pods, a Knative revision — and the code waits for the replacement to be "ready" using a predicate the *outgoing* thing already satisfies. `readyReplicas >= desired` is a true statement about a healthy Deployment, and it is true one millisecond after an apply, when the only pod in existence is the old one.

Nothing errors. The rollout is healthy, the pods are up, the log line is a green tick, and three separate commands agree the new release is live. The only disagreeing witness is the URL, which nobody consults because five other signals just said it was fine. It cost thirty minutes and two deploys to establish that a site had been serving a build from two days earlier.

The tell is a good one to carry around: **read the predicate and ask what was true one instant before the operation.** If the answer is "all of it", the check dates nothing.

The sweep found the bug in three more places — including one gating whether a runtime release advances across the entire fleet, whose own comment claimed it was immune. And it found the correct sibling, one file away: the Kaniko pod selection takes the newest non-terminating pod, with a comment naming the exact failure it avoids. The same bug, already learned once, in the same file as three that had not learned it.

## The highest-yield question is not "is this right?"

After the second full pass, one question turned out to produce more findings than any other, and it is not the obvious one.

Not *is this correct?* — but **does this agree with the thing next to it?**

Findings keep turning out to be an inconsistency with a *correct sibling* a few lines away. `X-Real-IP` read unconditionally, beside a carefully-reasoned `X-Forwarded-For` that handles proxy depth properly. `templates.userInvitation` skipped, three lines below a `templates.passwordReset` that was honoured. Both fixes were three lines. Finding them was the entire job.

This works because a codebase carries its own answers. Somebody already thought carefully about the hard version of the problem; the defect is the place that did not get the benefit of that thinking. Reviewing for correctness makes you reason from first principles about every line. Reviewing for *agreement* makes the codebase do most of the reasoning, and it scales to code you do not know well.

## Prove the gate fails

Step five is non-negotiable and it is the one that catches the embarrassing cases, because a change meant to alter a *gate* — a timeout, a lint suppression, a skip condition, a feature flag — can be syntactically perfect and completely inert.

Two we hit in a single day:

```js
it("…", async () => { … }), BOOTS_A_BACKEND;   // wrong — a comma expression
it("…", async () => { … }, BOOTS_A_BACKEND);   // right
```

The first evaluates the number and discards it. Every test stays on the 5-second default, and the suite still passes when it happens to be fast enough, so the "fix" reads as confirmed.

And an `eslint-disable-next-line` written as the first line of a multi-line comment block applies to the *next comment line*, not to the code. The directive has to be the last comment line before its target. Reasoning above it, directive on its own line underneath.

Neither is a syntax error. Nothing complains. The only evidence that a gate reaches the runner at all is watching it fail: set the timeout to 1ms and confirm every test dies.

One more, learned the hard way when we gated the rollout class: **the guard strips comments before matching.** All three fixes explained the old counters at length, so a guard that reads prose finds the explanation instead of the defect and passes every file that talks about the bug most.

## The honest limits

The catalogue is a repo-specific artefact and reads like one. Fifty entries is well past the length anyone reads front to back, and its real use is as a thing you grep when a bug looks familiar, plus a place the sweep logs accumulate. If you copy the idea, copy the discipline and start your own list at one; copying ours would give you fifty shapes, most of which are about someone else's architecture.

The classes are not disjoint, either. "A filter that matches nothing" and "a safety net that swallows its failure" are the same defect seen from two sides, and we have stopped trying to keep the taxonomy clean — a shape that helps you find things is doing its job even when it overlaps its neighbour.

And there is a failure mode built into the format: a document is not a guard. Our own rule is that anything that can become an executable check should, because a doc drifts silently and a check does not. The catalogue's job is the part that cannot be automated — noticing that the bug you just fixed has a shape, and going to look for the shape somewhere else before you close the ticket.

That step takes about an hour. It has never once come back empty.

---

One of the entries got a post of its own: [a refusal Postgres expresses as a number](/blog/2026-09-01-rls-does-not-raise-on-a-write-it-forbids/), which is class 39 and the sweep it produced.

Rebase is an open-source backend-as-a-service for Postgres — REST, a typed SDK, auth, storage, realtime and row-level security over a database you own, with an admin panel when you want one. It is [MIT-licensed on GitHub](https://github.com/rebasepro/rebase), and it is in public beta: the [compatibility page](/docs/compatibility) sets out exactly what may change and what may not.
