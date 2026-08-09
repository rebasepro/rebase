# Unit 35 — scheduled jobs (cron)

**Audited:** 2026-08-09 · read-only · `packages/server/src/cron/**` (loader, routes, scheduler,
store, `defineCron`, scale-to-zero), the mount and admin gate in
`packages/server/src/init.ts:1107-1158` and `:1739-1794`, the shutdown hook
(`packages/server/src/init/shutdown.ts:129`), the type declarations
(`packages/types/src/types/cron.ts`), the cron tables as exercised by
`packages/server-postgres/test/e2e/cron-claims-e2e.test.ts`, the revoke helper
(`packages/common/src/util/internal-tables.ts:114`), and the public docs
(`website/src/content/docs/{,de,es,fr,it,pt}/docs/backend/cron-jobs.md`).

Lens: bug-classes **19** (check-then-act inside the thing written to prevent a race) and **6**
(timing an async path by counting ticks). Class 23 is also live here — its worked example *is*
this scheduler.

## Verdict

**The multi-instance question has a real answer, and it is a good one.** N pods do not run a job
N times. Each pod derives the same slot from the cron expression, and
`INSERT INTO rebase.cron_claims (job_id, slot) … ON CONFLICT DO NOTHING RETURNING job_id`
(`cron-store.ts:294-301`) claims it in one statement — not a read followed by a write, so class 19
does not apply to the claim itself. It is proven rather than asserted: `cron-claims-e2e.test.ts`
races five independent schedulers, each with its own pool and driver, against one real Postgres,
through both the catch-up path and a real minute boundary, and asserts exactly one execution and
one claim. The class-23 overflow that this subsystem donated to `docs/bug-classes.md` is properly
fixed — the timer hops to the 32-bit ceiling, an early wake re-arms instead of claiming, and boot
sweeps claims that sit in the future.

So the headline defects are not in the claim. They are on either side of it.

**The lock is a tombstone, not a lease.** It is taken *before* the run and released on no exit
path at all — not on failure, not on timeout, not on `SIGTERM` mid-handler, not ever. A pod that
dies between claiming and finishing burns that slot permanently: no other pod will take it, and
catch-up on restart finds it claimed and moves on. Silently. `docs/bug-classes.md` §19 predicts
this in its own "watch for" paragraph.

**And the documented remedy for a missed slot is unreachable.** `catchUpWindowSeconds` has a
64-line docblock, a docs section, a unit suite and a Postgres e2e — and
`loadCronJobsFromDirectory` (`cron-loader.ts:66-73`) rebuilds the definition field by field and
does not copy it. The loader is the only production caller of `registerJobs`. Every test in the
repo calls `registerJobs` directly, which is why five layers of coverage never noticed. Class 21
(a declared extension point nothing reads) reached by class 3 (tests that bypass the wiring) and
class 17 (a parameter object re-listed by hand).

Below that: an unsatisfiable schedule fails toward *fire every minute* rather than *never fire*;
pausing a job is a per-process in-memory flag, so on the multi-pod deployment this whole design
exists for, the pause button returns 200 and changes nothing; and the RLS-bypass wording that
audit 36 corrected in `define-cron.ts` still stands in the type declaration, in the scheduler and
in the docs page.

---

## HIGH

### H1. `catchUpWindowSeconds` is dropped by the loader, so catch-up never runs in production

**`packages/server/src/cron/cron-loader.ts:66-73`**

```ts
const definition: CronJobDefinition = {
    schedule: def.schedule as string,
    name: (def.name as string) || id,
    description: def.description as string | undefined,
    enabled: def.enabled !== false,
    timeoutSeconds: (def.timeoutSeconds as number) || 300,
    handler: def.handler as CronJobDefinition["handler"]
};
```

Six of the seven fields of `CronJobDefinition`. `catchUpWindowSeconds`
(`packages/types/src/types/cron.ts:72`) is not among them.

`init.ts:1747` is the only production call to `loadCronJobsFromDirectory`, and `init.ts:1757` the
only production call to `registerJobs`. So for every job authored the documented way — a file in
`crons/` — `catchUpWindowSeconds` is `undefined` by the time the scheduler sees it, and
`catchUpMissedSlots` filters on `(job.definition.catchUpWindowSeconds ?? 0) > 0`
(`cron-scheduler.ts:606`), leaves the candidate list empty, and returns at `:608`. No warning:
the "configured but no claims store" warning at `:615` is downstream of that filter.

**Failure scenario.** A daily 06:00 scrape sets `catchUpWindowSeconds: 3600` exactly as
`website/.../cron-jobs.md:318-331` instructs. A rolling deploy retires the pod holding the timer at
05:59. The replacement computes the next slot from *now* — tomorrow — and today's run never
happens. The operator's mitigation was read, typed, type-checked, published in the reference
table, and discarded by the loader.

**Why nothing caught it.** `cron-scheduler.test.ts:791/855` and
`cron-claims-e2e.test.ts:346/374` both construct `LoadedCronJob` literals and call
`registerJobs` directly. There is no `cron-loader.test.ts` at all — `loadCronJobsFromDirectory`
is named in exactly one test file, and only as an import of its *type*.

**Fix direction.** Forward the object instead of re-listing it — `{ ...def, name: def.name ?? id,
timeoutSeconds: def.timeoutSeconds ?? 300, enabled: def.enabled !== false }` after the shape
check — so the eighth field cannot be lost the same way. Then a loader test that round-trips a
fixture file through the real `loadCronJobsFromDirectory` and asserts the *whole* definition
survived, not field by field (bug-classes §17: "assert the whole object arrived").

### H2. An unsatisfiable schedule fires every minute, forever

**`packages/server/src/cron/cron-scheduler.ts:152-162`**

```ts
for (let i = 0; i < MAX_SLOT_SEARCH_MINUTES; i++) { … }
// Fallback — should not happen with valid expressions
const fallback = new Date(after);
fallback.setMinutes(fallback.getMinutes() + 1);
return fallback;
```

`MAX_SLOT_SEARCH_MINUTES` is 525,960 — one year. When the walk finds nothing, the function does
not report "no slot"; it returns *one minute from now*, which `scheduleNext` arms as a normal
delay of 60,000 ms. The timer fires, `Date.now() >= nextRun` passes, the slot is claimed
(unique, because it is a fresh minute), and the handler runs. Then it does it again.

`validateCronExpression` (`:64-101`) checks each field against its own range independently, so it
accepts every expression below. Measured on node 22 with the exact algorithm from this file:

| expression | intent | result |
|---|---|---|
| `0 0 30 2 *` | never (Feb 30) | fallback → runs **every minute**, 99 ms scan each time |
| `0 0 31 4 *` | never (Apr 31) | fallback → runs every minute |
| `0 0 29 2 *` | **Feb 29, a legitimate schedule** | fallback → runs every minute, for up to ~3 years |

**Failure scenario.** A leap-day job. The author writes `0 0 29 2 *`, deploys, and the handler
runs 1,440 times a day instead of once every four years — with a `cron_claims` row and a
`cron_logs` row per minute (~525k of each per year) and ~100 ms of *synchronous* event-loop block
per minute for the failed search. If the handler mutates data, it does so 1,440× a day.

This is class 23's sibling along the other axis: the ceiling case was fixed so that arithmetic
past a platform limit no longer collapses to "fire now", but the *floor* case — arithmetic that
finds no answer at all — still collapses to "fire now". A floor without a ceiling was the tell
last time; a bound whose exhaustion is handled by a comment saying "should not happen" is this
one.

**Fix direction.** Make the no-slot case representable: return `undefined` from
`parseCronExpression` and have `scheduleNext` set `state = "error"`, set `lastError` to the
expression, log once and *not* re-arm. Better, reject it at registration: extend
`validateCronExpression` with a satisfiability check (day-of-month vs. the days each named month
actually has) so `0 0 30 2 *` is refused the way an out-of-range value already is, and a
legitimately-rare expression like `0 0 29 2 *` is scheduled by widening the search bound rather
than by falling through it.

### H3. Pause is an in-memory per-process flag, so it does nothing on a multi-instance deployment

**`packages/server/src/cron/cron-scheduler.ts:401-416`**, reached from
**`cron-routes.ts:67-81`** (`PUT /api/cron/:id`)

```ts
job.enabled = enabled;
```

Nothing else. Not persisted, not broadcast, not read back at boot — `start()` seeds `totalRuns`,
`totalFailures` and `lastRunAt` from the store (`:313-323`) and nothing else.

**Failure scenario.** Five pods behind a load balancer, the arrangement `cron_claims` exists to
support. An operator sees a job doing damage and hits pause in Studio
(`packages/studio/src/components/CronJobs/CronJobsView.tsx:208`). The request reaches one pod. It
answers `200` with `enabled: false`. The other four keep their timers, keep winning claims, and
keep running the job. The dashboard then polls every 15 s and shows whichever pod the balancer
picked, so the status flaps between `disabled` and `idle` while the job continues. A restart of
the one paused pod re-enables it there too. The docs advertise the opposite: *"Enable/disable —
Pause and resume jobs without restarting the server."*

The same is true of a *read*: `GET /api/cron` reports one arbitrary pod's `state`, `nextRunAt`
and `lastDurationMs`.

**Fix direction.** Persist the flag next to the claims — a `rebase.cron_state (job_id, enabled,
updated_at)` row, consulted in the timer callback immediately before the claim (it is one more
statement on a path that already does a round trip, and it can be folded into the claim's
`WHERE`), and seeded at `start()`. That makes pause cluster-wide and restart-durable in one
change. Until then the docs and the Studio button should say the scope is this instance.

---

## MEDIUM

### M1. The concurrency guard is check-then-act across the claim round trip (class 19)

**`packages/server/src/cron/cron-scheduler.ts:524-566`**

```ts
if (job.executing) { … return; }          // :524  ← check
…
claimed = await this.store.tryClaimRun(…); // :553  ← await, ~1 DB round trip
…
await this.executeJob(job, false);         // :566  → sets job.executing = true (at :695)
```

The flag that exists to prevent overlapping runs is read at `:524` and written at `:695`, with an
`await` on the database in between. `triggerJob` is safe in isolation — its check and its call to
`executeJob` are in one synchronous turn (`:430`→`:448`) — but a manual trigger that lands inside
the scheduled path's claim window sees `executing === false` and starts, and the scheduled path
then starts a second concurrent run of the same handler. Both then share one boolean: the first to
finish clears it in `executeJob`'s `finally` (`:755`) while the second is still running, so every
later guard is wrong too, and `job.state`, `lastRunAt` and `lastDurationMs` are interleaved
between two runs.

`catchUpMissedSlots` has the identical shape (`:626` check → `:639` await → `:654` execute).

The window is small — one `INSERT … RETURNING` — but it is exactly the mechanism whose stated
purpose is mutual exclusion, implemented as a read followed by a later unrelated write. That the
race is *hard to hit* is what let it be written; the idempotency store's was too.

**Fix direction.** Claim the in-process slot before yielding: set `job.executing = true`
synchronously at the top of the timer callback (after the cheap checks), and release it on every
exit path — the claim-lost branch, the early-wake re-arm, and the `finally` in `executeJob`.
A dedicated `job.starting` boolean read by both entry points is the smaller change; either way the
flag must be set in the same turn as the check that reads it.

### M2. The claim is never released — a pod that dies mid-job burns the slot permanently

**`cron-scheduler.ts:550-566`** takes the claim; **`cron-store.ts:292-312`** writes it; nothing
deletes it except the two boot sweeps in `ensureTable` (`:156-186`), which target *old* claims and
*future* claims, never a claim whose run did not complete.

So the claim is not a lease. It has no owner, no heartbeat and no expiry, and it is taken
**before** the handler runs. Consequences, in increasing order of surprise:

* A handler that throws leaves the claim. There is no retry — see M3.
* A handler that exceeds `timeoutSeconds` leaves the claim.
* `SIGTERM` during a run: `shutdown.ts:129` calls `stop()`, which clears timers and returns
  while the handler is still in flight (`cron-scheduler.ts:353-358` says so). The process exits,
  the run is truncated halfway, and the claim says it happened.
* A `SIGKILL`/OOM/node eviction between `:553` and `:566` — claim written, handler never entered —
  is indistinguishable from a completed run.

In all four cases no other instance will pick the slot up, and catch-up on the replacement pod
(once H1 is fixed) finds it claimed and skips. The run is lost with no error anywhere: the only
trace is the *absence* of a `cron_logs` row, which nothing looks for.

This is the contract the code actually implements — **at-most-once** — and it is a defensible
choice, but it is nowhere stated, and the docs' framing ("the claim is the only thing
distinguishing *this slot never ran* from *this slot already ran*") reads as though a claim
implies a run.

**Fix direction.** Decide and write down the contract. If at-most-once stands, say so in the type
docblock and the docs page, and make the gap observable — a claim with no matching `cron_logs`
row after `timeoutSeconds + margin` is a reportable orphan, cheaply detected by the boot sweep
that is already there. If at-least-once is wanted, the claim has to become a lease: a
`heartbeat_at` column, refreshed while the handler runs, with the claim reclaimable once it goes
stale (`ON CONFLICT … DO UPDATE … WHERE <expired> RETURNING`, the shape §19 prescribes).

### M3. No retries, no dead-lettering, no auto-disable — a job that always fails fires forever

**`cron-scheduler.ts:744-796`**

A failed run increments `job.totalFailures`, sets `state = "error"`, writes one `cron_logs` row
and one `logger.error` line, and the next tick is scheduled exactly as if it had succeeded
(`:569-571`). There is no backoff, no retry, no failure budget, and no threshold at which a job
is disabled or quarantined. A job that fails on every tick — a dead upstream, a deleted table, a
rotated credential — fails on every tick for as long as the deployment lives, and `totalFailures`
is a counter that only the dashboard reads. Nothing pages, nothing escalates, nothing stops.

Note also that the retry that *does* exist is the wrong one: a slot lost to a failure is never
re-attempted, because the claim from M2 records it as handled.

**Fix direction.** Minimum: a `consecutiveFailures` counter and a loud, structured log at a
threshold, plus a documented statement that cron has no retry so handlers must be idempotent and
self-retrying. Better: opt-in `retries`/`retryDelaySeconds` on the definition, and an opt-in
`disableAfterConsecutiveFailures`. Either way it must be a stated policy — "keeps firing" is a
choice a user cannot currently discover.

### M4. `cron_logs` has no retention at all, and claims are pruned only at boot

**`cron-store.ts:156-161`** sweeps `cron_claims` older than `CLAIM_RETENTION_DAYS` (7) — inside
`ensureTable`, which runs once per process at boot (`init.ts:1763`). **`cron_logs` is never
deleted from anywhere in the repo** (grep: the only `DELETE FROM` against either table is the two
claim sweeps).

**Failure scenario.** A `* * * * *` job on a pod that stays up for a year: ~525,000 `cron_logs`
rows, each carrying `result` and `logs` JSONB, plus ~525,000 `cron_claims` rows that the boot
sweep never gets a chance to trim because the process never restarts. Every subsequent boot then
runs `fetchJobStats` — `COUNT(*) … GROUP BY job_id` over the whole table (`:269-277`) — before
the counters are seeded.

**Fix direction.** A retention sweep for `cron_logs` alongside the claims one (keep N days or the
last N runs per job — the ring buffer already establishes 50 as the useful depth for the UI), and
move both sweeps onto a periodic timer rather than boot, so an instance that never restarts still
prunes.

### M5. Schedules are container-local time, undocumented, and lose an hour of runs at DST fall-back

`matchesCronFields` (`:129-135`) reads `getMonth`, `getDate`, `getDay`, `getHours`,
`getMinutes` — all local-time getters — and both walks step with `setMinutes`. There is no
`timezone` field on `CronJobDefinition`, and neither the docs page nor the schedule-syntax section
says which zone an expression is interpreted in. The answer is the container's `TZ`.

Measured with `TZ=America/New_York` on node 22, running the file's own algorithm:

* **Fall-back (2026-11-01).** After the 01:50 EDT slot, the next `*/10 * * * *` slot is
  `2026-11-01T07:00:00Z` = 02:00 EST — a **70-minute gap**. The entire repeated hour
  (06:00–06:59 UTC) is skipped, so six runs are silently lost. `30 2 * * *` fires at the second
  02:30, an hour later in absolute time than it did the day before.
* **Spring-forward (2026-03-08).** `30 2 * * *` is skipped for the day and next runs at
  02:30 the following day; `*/10` jumps 01:50 EST → 03:00 EDT. This half matches ordinary cron
  behaviour and is fine — it is the fall-back hole that is a surprise.

There is a second-order consequence for the claim. The slot ISO string is the coordination key,
so two instances of the same deployment with **different `TZ`** compute different keys for the
same intended run, both claims succeed, and both instances run the job. A base image change, or
one pod scheduled onto a node with a different `/etc/localtime`, is enough.

**Fix direction.** Document the zone at the top of the schedule-syntax section. Then either pin
the scheduler to UTC (read `getUTC*` unless a `timezone` is given) or add an explicit per-job
`timezone`, and — cheaply, today — log `Intl.DateTimeFormat().resolvedOptions().timeZone` at
scheduler start, so a mismatched pod is visible in the boot log rather than in duplicated runs.

---

## LOW

### L1. The RLS-bypass wording that audit 36 fixed survives in three cron surfaces

`define-cron.ts:11-19` now states it correctly — `dataAsAdmin` is admin-scoped, not an RLS
bypass. The sweep stopped there:

* **`packages/types/src/types/cron.ts:103-107`** — "*Its data plane is
  `RebaseServerClient.dataAsAdmin`, which runs with **admin privileges and bypasses RLS***". This
  is the docblock an IDE renders on hover over `ctx.rebase`, i.e. the copy most cron authors will
  actually read, and `defineCron`'s corrected text is only visible at the wrapper call.
* **`packages/server/src/cron/cron-scheduler.ts:245`** — "*when it is the RLS-bypassing one*".
* **`website/src/content/docs/docs/backend/cron-jobs.md:154`** — "*database operations run with
  bypass of Row-Level Security (RLS) policies*".

The docs page has two further drifts in the same section: its `CronJobContext` reference block
(`:132-146`) lists only `client: RebaseClient` and omits `rebase` entirely, and every example
uses `ctx.client.data` — the exact spelling `packages/types/src/types/cron.ts:129-142` deprecates
on the grounds that a reader who learns it here carries it to a collection callback where the same
name means the *user-scoped* plane.

**Fix direction.** One sentence, four places, and `verify:docs` cannot see prose. Worth naming the
claim in a single shared snippet the docs include and the docblocks reference.

### L2. `?limit` on the logs route is neither validated nor bounded

`cron-routes.ts:54-55`: `const limit = limitStr ? parseInt(limitStr, 10) : undefined;`

`?limit=abc` → `NaN` → `fetchLogs(id, NaN)` (the `= 50` default only applies to `undefined`) →
`LIMIT NaN` → Postgres `22P02` → swallowed at `cron-store.ts:260` → `[]` → the in-memory fallback
at `cron-scheduler.ts:382` does `limit ? logs.slice(0, limit) : logs`, and `NaN` is falsy, so it
returns **every** buffered log. `?limit=100000000` is an unbounded read of a JSONB table into
memory. The repo's stated policy for list limits is refuse, not clamp.

### L3. The timer callback's own "must never reject" invariant is unpinned

`cron-scheduler.ts:546-549` states that the callback must never reject "or the job would silently
stop rescheduling", and the claim block is carefully guarded — but `await this.executeJob(job,
false)` at `:566` is not, and neither is the `scheduleNext` after it. `executeJob` is non-throwing
by construction today (the handler race is inside a `try`, `insertLog` catches its own errors);
nothing enforces that, and the failure mode is a job that stops forever with no log line.
`try { … } finally { if (this.started && job.enabled) this.scheduleNext(id); }` around the body
makes the invariant structural.

### L4. `isUniqueViolation` cannot fire on the path it was written for

`cron-store.ts:82-88` is called only from `tryClaimRun`'s `catch` (`:303`), but the statement is
`ON CONFLICT (job_id, slot) DO NOTHING RETURNING`, which never raises `23505` — a lost race
returns zero rows and is handled at `:301`. Harmless (it is real cover for a hypothetical driver
without `ON CONFLICT`), but it reads as the mechanism that detects a lost claim when it is not,
which is the shape of bug-classes §18.

### L5. There is no `cron-loader` test

Five test files sit beside the loader; none of them exercises it. `loadCronJobsFromDirectory`
appears in exactly one test file, `define-cron.test.ts`, and only as a type import. This is the
sole reason H1 shipped.

### L6. `schema-admin` can trigger and pause every job

`packages/server/src/auth/middleware.ts:191-193` admits `admin` **or** `schema-admin`, and
`applyAdminGate` (`init.ts:1157`) is what stands in front of `/api/cron`. A role provisioned to
edit collections can therefore run arbitrary cron handlers on demand. Likely deliberate, but the
cron trigger is the most side-effectful admin surface there is and nothing states the intent.

### L7. `POST /:id/trigger` runs the handler inline in the HTTP request

`cron-routes.ts:39-49` awaits `triggerJob`, which awaits the handler under a `timeoutSeconds`
race defaulting to 300 s. Any proxy in front (ingress, Cloud Run, Cloudflare) will cut the
connection first; the run continues, and the caller — including Cloud Scheduler, which the
scale-to-zero warning explicitly recommends this endpoint to — sees a 504 and may retry, at which
point the `executing` guard turns the retry into `{ skipped: true }` with `success: true`. Accept
the trigger (202) and return the log via `/logs`, or document the ceiling.

### L8. The five translated copies of the cron docs are ~145 lines behind

`en` is 427 lines; `de`/`es`/`fr`/`it`/`pt` are 282–284. Missing from all five: the catch-up
section, the concurrency section, the timeout section, the persistence schema, and the
`ctx.client` discussion. (Consistent with the known docs-locale drift; noted here only for the
record.) Neither the English page nor any translation mentions `rebase.cron_claims` — the
"Database Persistence Schema" section documents `cron_logs` alone, so the table that makes
multi-instance safe is invisible to operators.

### L9. `timeoutSeconds: 0` silently becomes 300

`cron-loader.ts:71` uses `||`. Not a real intent anyone has, but `??` is free.

---

## Checked and clean

* **Claim atomicity.** One statement, `ON CONFLICT DO NOTHING … RETURNING`, keyed on a slot both
  instances derive from the expression rather than from their own wall clocks
  (`cron-store.ts:294-301`, `cron-scheduler.ts:553`). Not check-then-act. `findMostRecentSlot`
  zeroes seconds/ms (`:184-185`) so the same wall-clock slot serialises byte-identically down the
  scheduled and catch-up paths — the claim key depends on that and it is deliberate and commented.
* **Proven, not asserted.** `cron-claims-e2e.test.ts` runs five schedulers with five pools against
  one real Postgres and asserts exactly one execution per slot, including a control job with no
  claim that runs five times — so a broken claim fails the test rather than passing it vacuously.
* **Class 23 (the 32-bit timer clamp).** Fixed correctly and defensively: the hop at `:507-516`
  sleeps to the ceiling and re-derives, the early-wake guard at `:538-541` re-arms instead of
  claiming, and `ensureTable`'s future-slot sweep (`cron-store.ts:169-186`) releases a claim a
  premature timer already took. Three independent layers for one bug.
* **Boot-race hardening in `ensureTable`.** Each DDL step is independent, the sweeps and the
  privilege revocation are keyed on what exists rather than on who created it, and the revoke is
  re-applied on every boot whatever else failed (`cron-store.ts:148-202`) — with
  `has_table_privilege` assertions in the e2e (`cron-claims-e2e.test.ts:171`, `:300`), including
  after the tables are dropped and recreated.
* **The admin gate.** Deliberately not conditioned on `requireAuth` (`init.ts:1116-1125`),
  answers 501 rather than mounting open when no credential exists (`:1141-1153`), accepts `rk_`
  admin keys and the service key, refuses non-admin JWTs and service-scoped keys — all asserted
  end-to-end in `packages/server/test/admin-surfaces-gate.test.ts:149-250`.
* **Error redaction.** `cron-scheduler.ts:751` redacts at the point of capture, before the string
  reaches `cron_logs` and the Studio panel — a Drizzle failure would otherwise persist the
  statement and every bound value indefinitely.
* **Loader robustness.** Skips dotfiles (AppleDouble sidecars), `.d.ts`, `index.*` and `*.test.*`;
  one unimportable file does not take the others down; and the routes are mounted for the
  *directory* rather than for the jobs in it (`init.ts:1768-1780`), so a syntax error no longer
  404s the whole cron surface.
* **Catch-up degradation.** Refuses entirely without a claims-capable store, and fails *closed*
  when the claim throws (`cron-scheduler.ts:614-620`, `:640-647`) — deliberately the opposite of
  the scheduled path, and the comments say why.
* **Timer hygiene.** One timer per job (`scheduleNext` calls `stopJob` first), `unref`'d so
  shutdown is not blocked, state re-checked at fire time.
* **Scale-to-zero detection.** `KUBERNETES_SERVICE_HOST` exclusion is ordered first so Knative
  pods are not false positives; production-only; silenceable; wrapped so a detection bug can never
  affect boot. It answers the "who wakes it" question honestly — nobody does, and the warning
  names the external-trigger workaround. (It cannot know that the *other* remedy it implies,
  `catchUpWindowSeconds`, is the one H1 discards.)
* **Class 6.** No tick-counting anywhere in this unit's tests. `cron-scheduler.test.ts` uses
  `jest.advanceTimersByTimeAsync` against real wall-clock intervals, and the e2e polls with real
  sleeps against a real database.

---

## Open questions

1. **`dom`/`dow` are ANDed; POSIX cron ORs them.** `matchesCronFields` (`:129-135`) requires both
   to match. `crontab(5)` specifies that when *both* fields are restricted, a day matches if
   *either* does — so `0 9 1 * 1` means "every 1st **and** every Monday" in every other cron, and
   "the 1st, but only when it is a Monday" here (≈1–2 runs a year instead of ≈16). Every example
   in the docs table leaves one of the two as `*`, where the semantics coincide, so nothing states
   which was intended. Deliberate simplification, or an unnoticed incompatibility? Note that the
   AND reading is also what makes H2 reachable from rare-but-valid expressions.
2. **Is at-most-once the intended contract** (M2)? The answer decides whether the fix is a
   docblock or a lease.
3. **Managed multi-tenant runtime:** do tenants that share a Postgres share `rebase.cron_logs` /
   `rebase.cron_claims`? If two tenants ever share a database *and* a job id — and ids are derived
   from filenames, so `cleanup.ts` is not an unusual collision — they share a claim key and one
   tenant's run suppresses the other's. **UNCONFIRMED**; not investigated in this pass, and it is
   the one path by which a tenant could affect another's schedule.
4. **Should `PUT /:id` persist?** (H3.) Cluster-wide pause and restart-durable pause are the same
   change; the question is whether a file-declared `enabled: false` should be overridable at all,
   and which wins on the next deploy.
