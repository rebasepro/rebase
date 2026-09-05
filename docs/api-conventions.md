# API conventions

What every HTTP surface in `@rebasepro/server` is expected to look like, and
where the exceptions are.

This exists because the API grew one feature at a time. Each surface was
reasonable on its own; together they had three different ideas about where an
admin-only route lives, and the shape of a path had stopped predicting whether a
caller needed to be an admin. That is the kind of inconsistency nobody notices
while writing a feature and everybody pays for while integrating one.

The audit that produced this document is at the bottom: every route the server
mounts, and whether it conforms.

---

## 1. Where a surface lives

`basePath` defaults to `/api` and is configurable. Everything below is relative
to it.

| Kind of surface | Path | Who can call it |
|---|---|---|
| Data plane | `/data`, `/storage`, `/functions` | Whoever the collection's rules and the API key's scopes allow |
| Auth | `/auth` | Public by design — this is where a caller *becomes* somebody |
| Well-known | `/.well-known` | Public, and required to be, by the specs that define it |
| Admin | `/admin/**` | An admin, always |
| Mixed | `/meta` | Per route, documented at the route |

**An admin-only surface lives under `/admin`.** No exceptions that are not
listed in §7. This is the rule the codebase most recently broke and the one most
worth keeping: `/api/cron` looked like a data-plane path and was an admin
surface, and the only way to know was to read `init.ts`.

## 2. Errors

One envelope, everywhere:

```json
{ "error": { "code": "SCHEMA_CHANGE_UNAPPLICABLE", "message": "…", "details": {}, "requestId": "…" } }
```

Four fields, and no others. In particular there is **no `status`** in the body:
the status is on the response. A sample that shows one teaches callers to read
it from the wrong place, and the two can then disagree.

- `code` is `SCREAMING_SNAKE_CASE` and stable. It is what client code branches
  on, so treat it as part of the contract — see `docs/bug-classes.md` on
  re-deriving a shipped identifier.
- `message` is written for the person who will read it in a console, and names
  the obstacle rather than restating the rule. "There is no repository to commit
  to" beats "operation not permitted".
- `details` is optional and structured. Where a refusal is *about* something —
  a list of changes, a set of failing paths — it goes here rather than being
  formatted into `message`.
- `requestId` is optional and added by `errorHandler`, not by routes. It echoes
  the request's `X-Request-ID` when there is one, and is what a bug report
  quotes to find the server-side line.

Throw `ApiError` and let `errorHandler` format it. Do not build error bodies by
hand; a route that writes its own `c.json({ error: … }, 4xx)` is one that will
drift.

`ApiError.expected` marks a 4xx that is a normal outcome rather than an
incident, and drops its log line to `debug`. A refresh with no session, a
mistyped filter operator: nothing is wrong with the server and the response has
already said what to fix.

## 3. Status codes

| Code | Means |
|---|---|
| 400 | The request is malformed or asks for something impossible |
| 401 | No credential, or one that does not identify anybody |
| 403 | A credential that identifies somebody without the right |
| 404 | The thing addressed does not exist |
| 409 | The state conflicts — a dirty working tree, a duplicate key |
| 501 | The surface exists and is **not configured** on this deployment |

The distinction that matters is **404 vs 501**. A surface that is absent because
this deployment did not enable it answers 501 with a code and a reason. It does
*not* 404, because an unexplained 404 on a route the UI just called reads as a
broken deploy and gets debugged as one.

## 4. Availability

**Every optional surface answers `GET <surface>/status`**, unauthenticated
callers excepted, with either:

```json
{ "enabled": true }
```

or

```json
{ "enabled": false, "code": "SCHEMA_EDITOR_MISSING_DEPENDENCY", "reason": "…" }
```

The UI asks before it offers the control. The alternative is a button that looks
available and fails on press with a refusal the person could have been told
about up front.

A surface may add fields alongside these — live schema editing reports
`canPlan` separately from `enabled`, because previewing a change needs no
repository and refusing to preview would be a worse answer than the truth.

## 5. Shape of a route

- **Resources are plural nouns.** `/admin/api-keys`, `/admin/api-keys/:id`.
- **Verbs are allowed for actions that are not CRUD**, as a trailing segment on
  a `POST`: `/admin/cron/:id/trigger`, `/admin/schema/plan`,
  `/data/:slug/bulk/delete`. A schema change is not a resource and pretending it
  is produces worse names, not better ones.
- **A read-only preview of a write is its own route**, and is a `POST` because
  it takes a body. `plan` and `apply` are the pattern: anything with more than
  one possible verdict should be inspectable before it is done.

## 6. Admin is not one privilege

`/admin/**` means "an admin may call this". It does not mean every admin may do
everything the surface offers, and one surface already needs the distinction.

Live schema editing splits into two capabilities:

| Capability | What it does | Who |
|---|---|---|
| `plan` | Reads the collections and the catalogue, answers what a change would do. No side effects. | Anyone through the admin gate |
| `apply` | Commits to the repository, then runs the DDL. | A **person** |

The split is not between roles, it is between a person and a machine. Applying
writes a commit, the commit carries an author, and the author is the point — a
schema change with an author and a diff in the project's history is the thing
worth having. A service key has no author. `api-key:7c3f…` has no author.
Letting either write to the project's source produces exactly the unattributable
history the feature exists to replace, using the credential most likely to be
sitting in a CI environment variable.

So machines plan and do not apply. `liveSchema.allowMachineApply` (or
`REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY=true`) turns it on for a deployment that
genuinely wants an automated schema change, and the commit is then attributed to
the credential by name — `Rebase API key (7c3f)` — so that reading `git log` a
month later still distinguishes a change somebody made from one a pipeline made.

**A surface with capabilities reports them on `/status`**, per caller, not just
per server: `canPlan`, `canApply`, and `applyRefusedBecause` when the answer is
no. A UI can then disable the control *and say why*, instead of letting somebody
read a plan, decide, press, and only then be refused.

Where a lesser privilege is genuinely needed, it belongs in a capability check
like this one — not in `ADMINISTRATIVE_ROLES`, which is the list that decides
whether somebody is an admin at all, and which has been widened by accident
before (`packages/server/src/auth/admin-roles.ts`).

## 7. The exceptions, and why

**`/api/meta`** is mixed rather than admin. `/meta/contract` is admin-gated —
it is a full map of the schema, including tables no security rule would expose.
`/meta/schema-version` is deliberately open: it returns a version string that
stands for the schema without describing it, and a CI job holding no credentials
needs it.

**`/api/auth`** is public because it is where a caller becomes somebody. Its
admin-only siblings — user management, roles, password resets — live under
`/api/admin` and are gated there.

**The client SDK still calls the legacy paths.** `@rebasepro/client` defaults
`cronPath` to `/cron`, not `/admin/cron`. An SDK that moved first would break
against every server already deployed, and the alias in §8 means the old path
works indefinitely. The SDK moves at a major, together with the aliases.

## 8. Moving a surface that has shipped

Use `mountWithLegacyAlias` (`src/api/mount.ts`). It serves the same router at
both paths, so the two cannot drift — one set of handlers, one gate.

Responses through the legacy path carry:

```
Deprecation: true
Link: </api/admin/cron>; rel="successor-version"
```

An alias, not a 308: `fetch` follows redirects but drops `Authorization` on a
cross-origin hop, and much client code posts to these paths with one attached.

Aliases are removed at a major, not before. The header is what makes that
possible — an operator can find the callers still on the old path in their own
logs rather than discovering them when it is gone.

---

## The audit

Taken from the mounted surfaces in `init.ts`. "Gate" is what stands in front of
the router.

### Admin — under `/api/admin`

| Path | Gate | Notes |
|---|---|---|
| `/admin/api-keys` | admin | ✓ |
| `/admin/users`, `/admin/roles` | admin | ✓ |
| `/admin/backups` | admin | ✓ |
| `/admin/rls-audit` | admin | ✓ |
| `/admin/cron` | admin | **moved** from `/api/cron`; aliased |
| `/admin/logs` | admin | **moved** from `/api/logs`; aliased |
| `/admin/schema-editor` | admin | **moved** from `/api/schema-editor`; aliased |
| `/admin/schema` | admin | new — live schema editing |

### Data plane

| Path | Gate | Notes |
|---|---|---|
| `/data/**` | per-collection rules + API key scopes | ✓ |
| `/storage/**` | storage authz | ✓ |
| `/functions/**` | per-function guards | ✓ |

### Public by design

| Path | Notes |
|---|---|
| `/auth/**` | ✓ |
| `/.well-known/jwks.json` | ✓ |
| `/meta/schema-version` | ✓ — see §6 |
| `/livez` | ✓ — not under `basePath`, because a probe should not depend on it |

### Mixed

| Path | Notes |
|---|---|
| `/meta/contract` | admin-gated inside an ungated router — see §6 |

### Known drift, not yet fixed

- **`/api/storage` mixes nouns and verbs**: `/file/*`, `/list`, `/folder`,
  `/sources`, `/upload`, `/tus`. `/list` and `/upload` would be `GET /files` and
  `POST /files` under §5. Left alone deliberately: these are the most-called
  paths in the product, the `tus` ones implement a protocol whose shape is not
  ours to choose, and the churn is not worth it outside a major.
- **No `/status` on `/storage`, `/functions` or `/cron`.** They are not optional
  in the same way — a deployment either serves them or does not mount them at
  all — but §4 would still be better served by a uniform answer.
