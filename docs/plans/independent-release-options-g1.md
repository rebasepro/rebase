# Independent release of a unit — the options

Status: **decision document**, 2026-08-18. No code changed.
Resolves G1 of [independent-deployment-audit-2026-08-18.md](../audits/independent-deployment-audit-2026-08-18.md).
Read that first for why this is the only structural gap left on the self-host side.

---

## 0. The question, stated precisely

A split deployment today gives independent **isolation, scaling and restart**. Three
Deployments, three replica counts, three failure domains, one `kubectl rollout restart`
each. What it does not give is independent **release**: `charts/rebase/templates/deployment.yaml`
renders one global `image` for every backend unit, `bundle.url` is one global URL, and
`REBASE_FUNCTIONS_ONLY` selects at *boot* from a bundle that carries every function anyway.

So changing one line in one function rebuilds the whole bundle and rolls api, functions and
worker together.

Two things are worth separating before choosing, because they are routinely conflated:

- **Deploy granularity** — how little you have to *upload* for a one-function change.
- **Release granularity** — how little you have to *roll* for a one-function change.

Only the second is what "deploy functions independently" usually means, and only the second
has a correctness cost. §3 is that cost.

---

## 1. Why the units share a bundle at all

Not an accident, and not laziness. `defineFunction` hands every handler the full server-side
singleton:

```ts
export interface RebaseFunctionContext {
    rebase: /* dataAsAdmin, auth, storage, email, sql */;
}
```

`rebase.dataAsAdmin` is a real data client, which means a functions process needs the
collection registry, the drizzle tables built from it, the driver, the data sources and auth
— everything except the HTTP surfaces it does not mount. `init.ts` says so out loud:
switching `data` off stops `${basePath}/data` answering; it does not stop the registry being
built, *because functions read through it*.

A functions process is therefore **the same application, serving a different subset of
URLs** — not a service with its own domain model. Every option below is a position on
whether to keep that true.

---

## 2. What already works, and is worth not breaking

- **The URL surface is stable across a split.** Clients and generated SDKs see
  `/api/functions/<name>` whether one process serves it, the api forwards it
  (`REBASE_FUNCTIONS_UPSTREAM`), or the ingress fans it out. Swapping which process answers
  is invisible from outside — which is exactly the property that makes per-unit release
  *possible* rather than a client-visible migration.
- **Functions are name-addressed end to end** — flat loader, `functions/<name>` API-key
  scope, `REBASE_FUNCTIONS_ONLY`. There is no registry to keep in sync.
- **Static apps already have independent release** and are the existence proof: own image,
  own tag, own Deployment, `rebase build <app>` emitting a per-app `kind: static` bundle.
  They can do this because a static bundle has no share in the domain model at all.
- **Schema provisioning is additive and single-owner.** The api (or the migration Job)
  creates what is missing and never drops. This is what makes one direction of skew safe —
  see §3.

---

## 3. What skew actually breaks

Two units on different bundles means two versions of the *same* project against **one**
database. Four consequences, in descending order of how badly they fail:

1. **A function that leads the schema breaks outright.** The functions unit builds its
   drizzle tables from its own bundle's collections. If that bundle knows a column the api
   has not provisioned yet, the query is valid TypeScript against a column that does not
   exist, and fails at runtime as a SQL error.
2. **RLS follows the schema owner.** Policies are generated from the api's collections and
   applied by the api's role. A function relying on a policy the api has not applied is not
   an error — it is **zero rows and a 200**, which is the failure mode this codebase has
   been bitten by more than any other.
3. **Collection callbacks run in the process doing the write.** `beforeSave`/`afterSave`
   live in the bundle, so a write through `rebase.dataAsAdmin` on the functions unit runs
   the *functions bundle's* callbacks, while the same write through `/api/data` runs the
   *api bundle's*. Under skew, two versions of one callback run concurrently, chosen by
   which door the write came through. Nothing surfaces this.
4. **The contract endpoint is the api's.** `meta` is off on the functions role, so
   `/api/meta/contract` and `/api/meta/schema-version` always answer from the api. Good —
   clients get one source of truth — but it also means the api's schema is the published
   one whatever the functions unit believes.

**The safe direction follows from (1) and (2): the functions unit may lag, and must never
lead.** Roll the schema owner first, then the units that read behind it. That is the
ordinary rollout order anyway, which is what makes this a rule worth writing down rather
than a mechanism worth building.

**Detection is cheap; ordering is not.** `schemaVersion` is a hash of a projection, so a
functions process can compare its manifest against `GET /api/meta/schema-version` at boot
and know *whether* the two agree. It cannot know which is newer — a hash has no order. Any
option that wants to enforce direction rather than merely report disagreement has to add a
monotonic build identity to the manifest.

---

## 4. The options

### Option A — Per-unit image and tag pins

Chart gains `functions.image`, `functions.bundle`, likewise for `worker`. Nothing in the
runtime changes. You still build one bundle; you gain the ability to point units at
*different builds of it*, and therefore to roll one without the others.

| | |
|---|---|
| **Cost** | ~2h of templating, plus the boot-time skew check and the doc |
| **Deploy granularity** | Unchanged — a one-function change still uploads a whole bundle |
| **Release granularity** | Per unit. Roll functions, leave the api alone |
| **Skew** | Real, bounded: same project, N builds apart. §3 applies in full |
| **Self-host simplicity** | Untouched for anyone who does not set it |

The honest framing is that this **exposes** skew rather than introducing it — a split
deployment already skews for the duration of any rollout, and this makes the window a
decision instead of an accident. It needs a guard to be defensible: the functions unit
fetches `/api/meta/schema-version` at boot, and a mismatch is loud (warn by default,
refuse under `REBASE_REQUIRE_SCHEMA_MATCH=true`). That is a small, real feature, and it is
useful even without per-unit pins — it catches a half-finished rollout too.

**Forecloses nothing.** Options B and D can be built on top later; the values keys stay
meaningful under both.

### Option B — A functions-only bundle

`rebase build --functions` emits `kind: "functions"`: the compiled functions plus the
collection *projection* they need, without crons, hooks or static. Its own artifact, its own
version, its own image.

| | |
|---|---|
| **Cost** | High. Bundle format 3 — and per `bundle-runtime-contracts`, a manifest shape change has **three** compatibility directions, only one of which is protected for free. Plus a CLI command, `deploy-plan` intake, the chart, and the platform's parser |
| **Deploy granularity** | Better — a functions deploy carries no admin bundle, no crons |
| **Release granularity** | Per unit, same as A |
| **Skew** | *Worse*, not better. The functions bundle embeds a copy of the schema, so now there are two authored sources that can disagree, rather than two builds of one source |
| **Self-host simplicity** | A second build artifact and a second thing to explain |

The trap here is that it *feels* like the principled version of A while being strictly more
machinery for the same release granularity and a worse skew story. It only pays for itself
if the functions unit genuinely needs less than the whole model — and per §1, it does not.

**Recommend against**, unless Option D is the destination, in which case this is a
reasonable waypoint.

### Option C — Per-function content hashing

Trace the import graph per function so a deploy can say "only `send-invoice` changed". The
plan's own Phase 2.

This is a **deploy**-granularity feature, not a release-granularity one. On its own it
changes what you upload and nothing about what you roll — the same processes still restart
together. It composes with A (upload less *and* roll less) and is worth having for large
projects and slow links, but it does not answer G1 and should not be sequenced as if it
did.

### Option D — Functions as their own app

Use the existing `apps` registry — *"a repository declares apps, a project owns them"*,
multi-repo already supported — and let a functions app be its own project, reaching the
backend over HTTP through the SDK rather than in-process.

| | |
|---|---|
| **Cost** | Highest. It changes the `defineFunction` contract: no in-process `rebase.dataAsAdmin`, no `c.var.driver`, an explicit credential, a network hop |
| **Release granularity** | Total. This is actual service separation |
| **Skew** | Becomes an ordinary API-compatibility problem, which is a *solved* class — the generated SDK and `schemaVersion` already exist for exactly this |
| **Self-host simplicity** | Worse for the common case; better for the rare one |

This is the only option that makes functions genuinely independent rather than
independently-rolled. It is also a different product decision: it trades the thing that
makes Rebase functions pleasant (they are just server code with the whole singleton in
hand) for the thing that makes microservices scale organisationally. Worth holding as a
future **additional** mode — `runtime: "external"` on an app — not a replacement.

### Option E — Decline, and say so

Keep the bundle as the unit of release. Document that a split buys isolation and scaling,
and that rolling three Deployments from one tag is a single operation, not a burden.

| | |
|---|---|
| **Cost** | Zero, and it stays zero |
| **What it gives up** | A heavy function still cannot be patched without restarting the api. For a project where the api restart is the expensive one, that is the whole ask |

Not a strawman. Every consequence in §3 disappears, permanently, and the failure modes it
avoids are silent ones. If per-unit release is not being asked for by a real deployment, this
is the correct answer and the other four are speculative.

---

## 5. Recommendation

**A, with the guard, and write the contract down.** Specifically:

1. Ship the boot-time schema-version check first, on its own. The functions role fetches
   `/api/meta/schema-version` and compares it to its manifest's. Warn by default, refuse
   under a flag. This is useful immediately — it catches a stalled rollout in the topology
   we already support — and it is the precondition for everything else.
2. Then add `functions.image` / `functions.bundle` (and the `worker` equivalents) to the
   chart, documented with the rule from §3: **the schema owner rolls first; a unit may lag
   and must never lead.**
3. Leave C for when a project is big enough to feel the upload, and D for when somebody
   actually wants a separate repo with its own release cadence — at which point it is an
   additive app mode, not a migration.

The reason to prefer A over B is that A adds no new authored artifact and no new
compatibility surface, and the reason to prefer it over E is that the guard makes the
failure mode loud rather than silent — which is the only thing that made §3 frightening.

---

## 6. What has to be decided

| # | Question | Consequence |
|---|---|---|
| 1 | Is per-unit release actually being asked for by a deployment, or anticipated? | Decides A vs E outright |
| 2 | Warn or refuse on schema-version mismatch, by default? | Refusing is safer and will fail some legitimate rollouts mid-flight |
| 3 | Does the manifest gain a monotonic build identity? | Without one, skew is detectable but its *direction* is not, and the rollout rule stays a discipline rather than a mechanism |
| 4 | Does the cloud get per-unit pins too, or is the platform always one version? | `pinnedRuntimeEnv` and the fleet rollout assume one version stream; per-tenant per-unit pins multiply the matrix the rollout has to reason about |
| 5 | Is `runtime: "external"` (Option D) on the roadmap at all? | If yes, B stops being wasted work and becomes the waypoint |
