---
title: "Row-level security does not raise on a write it forbids"
description: "A DELETE your RLS policy rejects and a DELETE that had nothing to match are the same statement with the same result: zero rows, no error. Every other authorization failure in the stack throws. This one arrives as a number nobody reads — and it turns a 403 into a 204."
pubDate: 2026-09-01
authors: francesco
---

Here is a thing about Postgres row-level security that is documented, unsurprising once stated, and still catches almost everyone who builds on it.

RLS does not throw when it refuses your write.

A `USING` clause is a filter. It decides which rows the statement is allowed to *see*. So a `DELETE` that your policy forbids and a `DELETE` that simply had nothing to match are, from the database's point of view, the same statement with the same outcome: zero rows affected, no error, transaction commits fine.

Every other authorization failure in a normal stack throws something. A missing scope on a token throws. An expired session throws. A `WITH CHECK` violation — the *other* half of RLS, the one that governs the values you are writing — throws, loudly, with `new row violates row-level security policy`. That asymmetry is the trap: you meet `WITH CHECK` early, it behaves like an authorization error should, and you form the reasonable belief that RLS raises on denial.

It does, on inserts. On refused updates and deletes it hands you a `rowCount` of `0` and waits to see whether you were paying attention.

## What that looks like in a real handler

The bug this produces is not a wrong line of code. It is an *absent* one:

```ts
await tx.delete(orders).where(eq(orders.id, id));
return c.body(null, 204);
```

That reads as finished code. It reads as finished code in review, too — there is no missing check to point at, no unhandled branch, nothing to leave a comment on. The write was issued, it did not throw, and the handler reports what handlers report after a successful delete.

Now put two entirely correct security decisions on either side of it. An API key scoped to `orders:delete`, so the route-level guard is satisfied. A collection whose rules grant the `service` role only `select`, so the RLS policy refuses the delete. Both gates work exactly as designed, and their combination is a caller that deletes nothing, forever, and is congratulated every time. The route answers `204`. The SDK's promise resolves. An agent acting on that response records that the order was refunded and removed. The row is still there.

This is the failure direction that costs the most, because there is nothing to debug until someone notices by other means — usually a customer, usually much later, usually about data that was supposed to be gone.

## Telling "refused" apart from "not there"

The fix needs one more read, and the interesting part is *which handle* performs it.

If, after a zero-row write, the target row is still visible, then a policy refused the write: that is a `403`. If it is not visible, there is nothing there for this caller, and the honest answer is a `404` — the same answer a `GET` would have given.

The re-read has to run on the **same RLS-scoped connection as the write**. Doing it on a privileged handle instead would be answering the question for a different caller, and it would leak the row's existence to someone whose policies say they cannot see it. "This row exists but you may not touch it" is a fact, and it belongs only to callers who can already read the row.

In Rebase that rule lives in exactly one place — `explainZeroRowWrite`, in `packages/server-postgres/src/services/write-denial.ts` — because a rule about disclosure that exists in two implementations is a rule with two futures.

## The sweep is where the value is

Finding one instance of this is worth a fix. Finding the shape is worth an afternoon, because the query that finds it is trivial:

```sh
grep -rnE '(await|return) [a-z]+\.(delete|update)\(' packages/*/src
```

Then look at what happens to each result. A write whose row count is never compared against what the caller asked for cannot report a refusal — that is the whole test, and it is mechanical.

Three things that came out of running it here, all of which generalise:

**The comparison is not always against zero.** A membership save says "remove these five links". Four is the same defect as zero, quieter. Any write with a knowable expected count needs to compare against *that*, not against emptiness.

**The levels below the row are separate policies.** `DELETE /authors/1/tags/5` does not delete a tag. It deletes a junction row, and the junction table's own policies decide it. Our row-level guard landed, looked complete, and left both the junction delete and the many-to-many relation sync silently reporting success — reachable from the same REST surface, one URL over. Junction tables are where authorization holes live generally; this is one more reason.

**Some zeros are legitimate, and saying so is part of the work.** "Delete everything I can see" makes no claim about any particular row, so zero is a correct answer and guarding it would be wrong. Relation FK-clearing is the same. The output of the sweep is not "guard every write" — it is a list where each entry is either fixed or explicitly marked as one where zero is fine, because an unexamined write and a deliberately-unguarded one look identical six months later.

## The mock that models the fix away

One detail worth its own paragraph, because it will happen to you.

Three of our unit suites had `delete: jest.fn(async () => undefined)`. A fake database that reports nothing about how many rows it removed. Under the new guard those suites failed — correctly, because what they described was a database refusing every single delete.

The instinct is to patch the mock and move on. The better reading is that the mock had been *asserting nothing* about denial the entire time, and now cannot. A stub that omits `rowCount` was a neutral stand-in right up until `rowCount` started carrying meaning, and at that moment it became a fixture that quietly disagrees with production. Any test suite that mocks the database layer has some number of these, and you find them by changing what the real layer means.

## Why this is an argument for the model, not against it

It would be easy to read all of this as a reason to keep authorization in application code, where denial is an exception you cannot ignore.

I do not think it is. The reason is that this bug is *findable*. It has a grep. It has a single shape, it has one fix, and once the fix exists in one module every future write can route through it. Compare that to the failure mode of application-level authorization, which is a check that was never written — invisible to every search, because you cannot grep for absent code.

What the RLS version costs you is a discipline: **read the row count, always, and decide what a zero means.** That is a much better trade than it looks, because it is a rule you can enforce mechanically, and because everything it does not cover still fails closed. A write that RLS refuses does not corrupt data or leak rows. It does nothing at all. The only thing at risk is the story your API tells about it — which is exactly the part you can fix in one place.

## If you take one thing

If your stack uses RLS and you have never checked, go and look at your delete and update handlers right now. Not for a bug — for a discarded return value. Every place you find one is a route that currently cannot distinguish "forbidden" from "done", and the odds are good that at least one of them is answering `204` to a caller whose policies have been refusing it all along.

You would rather know today.

---

Rebase generates Postgres row-level security from the same definition that generates your API, so the policies and the routes cannot drift apart. It is an open-source backend-as-a-service for Postgres — REST, a typed SDK, auth, storage, realtime and RLS over a database you own — [MIT-licensed on GitHub](https://github.com/rebasepro/rebase), and in public beta. If you want to know whether your own database leaks today, `npx @rebasepro/rls-check "<connection string>"` is free, read-only and knows nothing about Rebase.
