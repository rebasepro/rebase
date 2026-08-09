# Audit map

A register of the units in this repo that are worth auditing **on their own** — one
sitting, one scope, one write-up. The point is not "audit the codebase"; that
produces a shallow pass over everything. The point is that each entry below has its
own failure modes, its own reviewers' questions, and can be declared done.

Status legend:

- **done ‹date›** — a written audit exists; findings tracked or fixed.
- **partial** — covered incidentally inside a broader audit or sweep, never on its own.
- **never** — no dedicated pass.

Forty-six units now have a dedicated write-up in [audits/](audits/), one file per entry,
numbered to match. Those marks were reconciled on 2026-08-09: the register had been
left saying `partial` or `never` for units whose write-up was already sitting next to
it — entry 3 read **never** against a fourteen-finding audit of write validation — so
it described the repo as far less audited than it is. **A `done` mark means the pass
happened, not that the findings are closed.** What is still open is below.

Existing write-ups this register was reconciled against: [AUDIT-2026-07-28.md](AUDIT-2026-07-28.md),
[AUDIT-storage-2026-08-07.md](AUDIT-storage-2026-08-07.md),
[api-surface-audit-2026-08-05.md](api-surface-audit-2026-08-05.md),
[dx-audit-2026-07-25.md](dx-audit-2026-07-25.md),
[dx-audit-2026-08-09.md](dx-audit-2026-08-09.md),
[sdk-generation-audit-2026-08-08.md](sdk-generation-audit-2026-08-08.md),
[type-placement-audit-2026-07-28.md](type-placement-audit-2026-07-28.md),
[saas/SWEEP-2026-08-07.md](../saas/SWEEP-2026-08-07.md), and the sweep log in
[bug-classes.md](bug-classes.md).

---

## Still open, verified against the code on 2026-08-09

The write-ups state the code as it was on the day of the pass. Most of what they
found was closed by the `sweep/2026-08-08` fix branches, which map one-to-one onto
the units below. Re-checking the severity-coded findings against current `main`:
**all 4 Criticals are fixed**, and of the 29 Highs checked so far, 26 are fixed and
these three are not.

1. **Anonymous sign-in ignores `disableSelfRegistration`** (unit 18, H4).
   `POST /auth/anonymous` (`server/src/auth/session-routes.ts:359`) goes from the rate
   limiter straight to `createUser`. It never calls `isRegistrationOpen`, which the
   `/config` route thirty lines above does call, and no `enableAnonymous`-style flag
   exists anywhere. A deployment that has closed registration still hands anyone a
   user and a session.
2. **Storage has no rate limiter at all** (unit 24, H2). `createDataRateLimiter` is
   mounted on the data router (`server/src/init.ts:1490`) and the functions router
   (`:1740`) and nowhere else. Upload, download and TUS are unlimited.
3. **`checkPolicyDrift` never checks whether RLS is on** (unit 17, H3).
   `server-postgres/src/security/policy-drift.ts:128` reads `pg_policies` only, never
   `pg_class.relrowsecurity`. A table with correct policies and RLS switched off
   reports zero drift — the one state the checker most needs to catch.

**Coverage caveat:** 64 of the 93 High findings have not been re-checked against
current code, so their write-ups' verdicts still stand unverified. Mediums and Lows
were not re-checked at all. Absence from this list is not evidence of a fix.

---

## A. Data path — request to row

1. **Query parser / where-clause contract** — `packages/server/src/api/rest/query-parser.ts`,
   `packages/client/src/query_builder.ts`, `sdk_query_builder.ts`.
   Every operator, on every property type, end to end: does the parser accept what the
   builder emits, does the REST layer forward every parsed param, does an unsupported
   operator 400 rather than silently widen? Prior hits: dropped params, unsorted
   `orderBy` returning 200. **done 2026-08-09** — see [audits/01-query-parser-contract.md](audits/01-query-parser-contract.md).
2. **REST API generator + route surface** — `api/rest/api-generator.ts`, `index.ts`.
   Route-by-route: auth gate present, RLS scope bound, error envelope shape, status
   codes, pagination/count semantics. **done 2026-08-09** — see [audits/02-rest-route-surface.md](audits/02-rest-route-surface.md).
3. **Write validation & coercion** — `api/rest/write-validation.ts`, `data-transformer.ts`.
   Type coercion per property type, rejection vs. clamping (bug class 23), nested/relation
   write shapes, unknown-key handling. **done 2026-08-08** — see [audits/03-write-validation.md](audits/03-write-validation.md).
4. **Idempotency** — `api/rest/idempotency.ts`. Key scope, replay window, storage,
   concurrent-duplicate behaviour, what happens on a partial failure. **done 2026-08-08** — see [audits/04-idempotency.md](audits/04-idempotency.md).
5. **Relations & junctions** — `server-postgres/src/collections/validate-relations.ts`,
   FK naming, m2m junction generation. Read shape vs. write shape asymmetry, irregular
   plurals, cascade behaviour, orphan rows. **done 2026-08-09** — see [audits/05-relations-and-junctions.md](audits/05-relations-and-junctions.md).
6. **History / audit log** — `server/src/history/`, `server-postgres/src/history/`.
   Who can read it, what it records, whether it leaks columns RLS would hide. One RLS
   bypass already found here — the sibling routes were never swept. **done 2026-08-09** — see [audits/06-history-and-audit-log.md](audits/06-history-and-audit-log.md).
7. **Search & vector search** — `schema/search-column.ts`, `client/src/vector-search-query.test.ts`.
   Generated-column immutability, ranking, injection surface, index maintenance. **done 2026-08-08** — see [audits/07-search-and-vector.md](audits/07-search-and-vector.md).
8. **OpenAPI generator** — `api/openapi-generator.ts`. Does the emitted spec match the
   routes that actually exist, including auth and error responses? **done 2026-08-08** — see [audits/08-openapi-generator.md](audits/08-openapi-generator.md).

## B. Schema & migrations

9. **Schema generation (Drizzle + DDL)** — `schema/generate-drizzle-schema*.ts`,
   `generate-postgres-ddl*.ts`. Escaping in every position (bug class 35), reserved words,
   identifier length, type mapping. **done 2026-08-08** (SDK side) / **partial** (DDL side)
10. **Introspection** — `schema/introspect-db-*.ts` (7 files). Round-trip fidelity:
    introspect → generate → introspect. Naming inference, constraint inference, types
    Postgres allows that the generator doesn't. **partial**
11. **Migration ordering & application** — Drizzle journal, `when` high-water mark,
    out-of-order skips, destructive-push gate (`schema/destructive-sql.ts`). **partial**
12. **Boot-time schema ensure** — `boot/ddl-bootstrap.ts`, `ensure-collection-schema.ts`,
    `schema/ensure-collection-tables.ts`, `ensure-collection-policies.ts`.
    Concurrency (CREATE IF NOT EXISTS races), the six early-return gates, upgrade paths
    from an older stamped schema. **done 2026-08-09** — see [audits/12-boot-schema-ensure.md](audits/12-boot-schema-ensure.md).
13. **Upgrade / version-skew path** — `boot/version-skew.ts`, `schema-version.ts`,
    `scripts/record-schema-snapshot.mts`, upgrade-e2e. Every N→N+1 boot from a real
    snapshot; the FK-rename brick is open. **done 2026-08-09** — see [audits/13-upgrade-and-version-skew.md](audits/13-upgrade-and-version-skew.md).
14. **Doctor** — `schema/doctor.ts`, `doctor-cli.ts`, `cli/src/commands/doctor.ts`.
    Does each diagnostic fire on a real broken DB, and is its remediation text correct
    (bug class 5)? **done 2026-08-08** — see [audits/14-doctor.md](audits/14-doctor.md).
15. **Backups & PITR** — `server/src/backup/`, `server-postgres/src/backup/`, `docs/backups.md`.
    Restore actually restores; exclude lists fail closed; PITR cutover. **done 2026-08-09** — see [audits/15-backups-and-pitr.md](audits/15-backups-and-pitr.md).

## C. Security

16. **RLS policy generation** — `security/rls-enforcement.ts`, `rls-bootstrap-sql.ts`,
    `sqlToPolicy`. Predicate hoisting, unqualified columns binding to the wrong table,
    hashed/injected names, derived junction policies. **done 2026-08-09** — see [audits/16-rls-policy-generation.md](audits/16-rls-policy-generation.md).
17. **RLS drift & scanning** — `policy-drift.ts`, `packages/rls-check`, `scripts/rls-scan.mts`,
    `rls-baseline.json`. Does the scanner catch what it claims — and what class of hole is
    invisible to it? **done 2026-08-09** — see [audits/17-rls-drift-and-scanning.md](audits/17-rls-drift-and-scanning.md).
18. **Auth core** — `server/src/auth/routes.ts`, `middleware.ts`, `require-auth.ts`,
    `session-routes.ts`, `jwt.ts`, `password.ts`, `bearer-token.ts`, `cookie-utils.ts`.
    Token lifetime, refresh rotation/reuse detection, cookie flags, session revocation. **done 2026-08-09** — see [audits/18-auth-core.md](audits/18-auth-core.md).
19. **OAuth providers** — 12 provider files (`google-`, `github-`, `apple-`, `microsoft-`,
    `facebook-`, `twitter-`, `linkedin-`, `gitlab-`, `bitbucket-`, `discord-`, `slack-`,
    `spotify-oauth.ts`). One audit, twelve implementations of the same predicate
    (bug class 2): state/PKCE, redirect-URI validation, account-linking, email-verified trust. **done 2026-08-08** — see [audits/19-oauth-providers.md](audits/19-oauth-providers.md).
20. **MFA** — `mfa.ts`, `mfa-crypto.ts`, `mfa-routes.ts`. Enrolment, recovery codes,
    rate limiting, downgrade-to-password bypass. **done 2026-08-08** — see [audits/20-mfa.md](audits/20-mfa.md).
21. **Magic links & password reset** — `magic-link-routes.ts`, `reset-password-admin.ts`.
    Token entropy/expiry/single-use, enumeration, the invite-sends-a-reset class. **done 2026-08-09** — see [audits/21-magic-links-and-reset.md](audits/21-magic-links-and-reset.md).
22. **Users, roles & admin ops** — `admin-roles-route.ts`, `admin-user-ops.ts`,
    `admin-users-route.ts`, `registration-policy.ts`, `rls-scope.ts`, bootstrap exception.
    Privilege escalation, self-role-grant, the empty-table first-admin path. **done 2026-08-09** — see [audits/22-users-roles-admin-ops.md](audits/22-users-roles-admin-ops.md).
23. **API keys** — `auth/api-keys/*` (6 files). Double gating (permission list + RLS),
    key storage/rotation/revocation, `access: "public"` semantics. **done 2026-08-09** — see [audits/23-api-keys.md](audits/23-api-keys.md).
24. **Rate limiting** — `rate-limiter.ts`, `rate-limit-store.ts`. Header-spoofed client
    identity (X-Real-IP class), per-route coverage, multi-instance correctness. **done 2026-08-09** — see [audits/24-rate-limiting.md](audits/24-rate-limiting.md).
25. **Custom & adapter auth** — `custom-auth-adapter.ts`, `builtin-auth-adapter.ts`,
    `adapter-middleware.ts`, `auth-hooks.ts`. Which callbacks are bypassed on which path
    (signups already known to skip before/afterSave). **done 2026-08-09** — see [audits/25-adapter-and-custom-auth.md](audits/25-adapter-and-custom-auth.md).
26. **Storage authorization** — `storage/routes.ts`, `keys.ts`, path canonicalization,
    signed URLs, per-source authz. **done 2026-08-07**
27. **Secrets & encryption** — `ENCRYPTION_KEY` handling, `crypto-utils.ts`, env-var
    encryption in saas, key rotation story. **done 2026-08-09** — see [audits/27-secrets-and-encryption.md](audits/27-secrets-and-encryption.md).
28. **Dependency & supply chain** — `pnpm-workspace.yaml` overrides (bounded?),
    `scripts/check-undeclared-deps.mjs`, published-dist runtime deps, npm trusted publishers. **partial**

## D. Storage

29. **Storage controllers** — `LocalStorageController.ts`, `S3StorageController.ts`,
    `GCSStorageController.ts`. Three implementations of one interface: list/delete/copy
    semantics, error mapping, streaming and memory behaviour. **partial**
30. **Multi-source storage topology** — `storage-registry.ts`, `client/src/storage-registry.ts`,
    `rebase.json` topology, `<BASE>__<KEY>` env suffix, migration between sources. **partial**
31. **Uploads: tus + image transforms** — `tus-handler.ts`, `image-transform.ts`.
    Resumable-upload state, orphan cleanup, transform param validation, decompression bombs. **done 2026-08-08** — see [audits/31-uploads-tus-transforms.md](audits/31-uploads-tus-transforms.md).

## E. Realtime, jobs, side effects

32. **Realtime / CDC** — `services/routed-realtime-service.ts`, `server-postgres/src/websocket.ts`,
    `client/src/websocket.ts`, `realtime-channel.ts`. Triggers→pg_notify, RLS-safe refetch,
    the auth race, subscription keys, row identity, reconnect/backfill. **done 2026-08-09** — see [audits/32-realtime-cdc.md](audits/32-realtime-cdc.md).
33. **Channel bus & presence** — opt-in `realtime.bus`; cross-instance correctness when the
    default memory bus is used in a multi-pod deploy. **done 2026-08-08** — see [audits/33-channel-bus-presence.md](audits/33-channel-bus-presence.md).
34. **Offline sync** — `client/src/offline*.ts` (9 files + tests). Conflict resolution,
    codec/version skew, IDB store eviction, replay ordering. **done 2026-08-09** — see [audits/34-offline-sync.md](audits/34-offline-sync.md).
35. **Cron** — `server/src/cron/*` incl. `scale-to-zero.ts`. Missed-tick semantics,
    overlap/locking across instances, timezone/DST, scale-to-zero vs. due jobs. **done 2026-08-09** — see [audits/35-cron.md](audits/35-cron.md).
36. **Functions** — `functions/define-function.ts`, `function-loader.ts`, `function-routes.ts`.
    Auth defaults, error surface, loader failure modes, timeout/cancellation. **done 2026-08-08** — see [audits/36-functions.md](audits/36-functions.md).
37. **Webhooks** — `services/webhook-service.ts`. Retry/backoff, signing, at-least-once
    duplication, SSRF on user-supplied URLs. **done 2026-08-08** — see [audits/37-webhooks.md](audits/37-webhooks.md).
38. **Email** — `email/smtp-email-service.ts`, `templates.ts`. Template injection, bounce
    handling, deliverability-affecting headers, failure swallowing. **done 2026-08-08** — see [audits/38-email.md](audits/38-email.md).

## F. Client SDK & codegen

39. **HTTP transport & client lifecycle** — `client/src/transport.ts`, `client-close.ts`,
    base-URL resolution, retry, abort, auth-refresh overflow. **partial**
40. **Generated SDK** — `packages/codegen`, `cli generate_sdk`. Names are wire names,
    escaping, nullability, relation accessors, regeneration idempotence. **done 2026-08-08**
41. **Typed query contract** — `query-contract.types.ts`. Do the types actually reject
    what the server rejects, and accept what it accepts? Type assertions in tests are
    inert here — check where the contract is really enforced. **done 2026-08-08** — see [audits/41-typed-query-contract.md](audits/41-typed-query-contract.md).
42. **client-postgres (direct/PostgREST path)** — `packages/client-postgres`. A second
    implementation of the data path; does it agree with the HTTP client on filters,
    ordering, errors? **done 2026-08-08** — see [audits/42-client-postgres.md](audits/42-client-postgres.md).
43. **server-mongo** — `packages/server-mongo`. Feature parity vs. Postgres, or an honest
    statement of what it does not support. **done 2026-08-08** — see [audits/43-server-mongo.md](audits/43-server-mongo.md).
44. **firebase package** — `packages/firebase`. Still shipped, largely legacy: audit for
    dead surface and drift from current types. **done 2026-08-08** — see [audits/44-firebase-package.md](audits/44-firebase-package.md).

## G. Admin UI & UI kit

45. **UI kit primitives** — `packages/ui/src/components` (108 files). Accessibility
    (focus, roles, keyboard), controlled/uncontrolled consistency, portal/z-index/scroll-lock
    (bug classes 25 and 32), dark mode. Worth splitting: overlays, inputs, data display. **partial**
46. **UI theming & CSS layering** — `theme.css`, `index.css`, unlayered CSS beating Tailwind
    utilities, token drift vs. `UIReferenceView`. **partial**
47. **Collection views** — `ui/src/views/CollectionView`, `KanbanView`, `ListView`, `CardView`.
    Virtualization, selection, order keys/collation, empty and error states. **partial**
48. **Entity form & fields** — `admin/src/form`, `field_configs.tsx`, `packages/forms`.
    Per-property-type: validation, dirty tracking, save/discard, nested arrays, unsaved-changes
    navigation (bug class 28). **partial**
49. **Collection editor** — `admin/src/collection_editor`. Schema edits from the UI:
    what it can express vs. what the backend accepts, destructive-change guards. **done 2026-08-08** — see [audits/49-collection-editor.md](audits/49-collection-editor.md).
50. **Data import/export** — `admin/src/data_export`, `data_import`. Type fidelity round-trip,
    large-file behaviour, CSV injection, partial-failure reporting. **done 2026-08-08** — see [audits/50-data-import-export.md](audits/50-data-import-export.md).
51. **References & relation pickers** — `ReferenceWidget.tsx`, `RelationSelector.tsx`,
    `ReferenceTable`, `UserSelector.tsx`. Permission-aware listing, pagination, write shape. **done 2026-08-08** — see [audits/51-references-relation-pickers.md](audits/51-references-relation-pickers.md).
52. **Admin routing, layout & navigation** — `RebaseAdmin.tsx`, `RebaseRouteDefs.tsx`,
    `RebaseAuthGate.tsx`, `SideDialogs.tsx`, `RebaseNavigation.tsx`. Deep links, back/forward,
    side-panel stacking, auth-gate flicker. **partial**
53. **App core & plugin lifecycle** — `packages/app/src/core/*`, `PluginLifecycleManager.tsx`.
    Declared extension points that nothing reads (bug class 21), mount/unmount ordering. **partial**
54. **Import cycles & bundle shape** — `docs/admin-import-cycles.md`, headless guard.
    Whether the headless/browser split still holds. **partial**
55. **i18n** — `app/src/i18n`, `locales`, `saas/frontend/src/locales.ts`, website locales.
    Missing keys, untranslated baseline drift, RTL/pluralization. **partial**
56. **Studio** — `packages/studio`, `api/ast-schema-editor.ts`, `schema-editor-routes.ts`,
    saas `studio-ws-bridge.ts`. Availability contract, WS bridge auth, edits that don't
    round-trip. **partial**
57. **Plugins: AI and Insights** — `packages/plugin-ai`, `packages/plugin-insights`,
    `packages/inference`. Prompt/data leakage, cost controls, failure UX, inference
    correctness on real schemas. **done 2026-08-08** — see [audits/57-ai-insights-plugins.md](audits/57-ai-insights-plugins.md).

## H. CLI & developer experience

58. **`rebase init`** — `commands/init.ts` + tests. Port probing (the loopback-postgres
    misroute), template correctness, refusal guards, re-run on an existing project. **partial**
59. **`rebase dev` / `start`** — two processes, port reporting, reload, crash surfacing. **partial**
60. **`rebase build` / bundle / fold-static** — `bundle.ts`, `fold-static.ts`, `manifest.ts`.
    Bundle contract vs. runtime expectations, declared deps, reproducibility. **partial**
61. **`rebase db` / `schema`** — push/pull safety, destructive gate, dry-run honesty. **partial**
62. **`rebase cloud`** — `commands/cloud/`. JSON-mode off-TTY, error messages, auth,
    idempotency of deploy. **partial**
63. **`rebase eject`** — does the ejected project actually build and run? **done 2026-08-08** — see [audits/63-cli-eject.md](audits/63-cli-eject.md).
64. **CLI auth, api-keys, apps, telemetry, skills commands** — smaller surfaces, never
    swept together: consent, storage of credentials, what telemetry sends. **done 2026-08-08** — see [audits/64-cli-small-commands.md](audits/64-cli-small-commands.md).
65. **Scaffolded templates** — `scripts/check-templates.mjs`, `test-cli-init-*-project`.
    Every template: installs, typechecks, boots, deploys. `NODE_ENV` baked into builds
    was found here. **partial**
66. **Error messages & DX surface** — a cross-cutting pass over the errors a developer
    actually hits first (bad config, missing env, wrong driver version): are they
    actionable and true? **partial (dx-audit-2026-07-25, dx-audit-2026-08-09)** — the
    later pass drove the published CLI against real Postgres rather than the repo, so
    its findings are reproductions; still not a dedicated pass over error text alone.
67. **MCP server** — `packages/mcp`. Tool surface, authz, what it exposes about the DB.
    **done** — see [audits/67-mcp-server.md](audits/67-mcp-server.md). H1/H2/H3/M1 have since been
    fixed, so that write-up reads worse than the current code; **M2 is still open** — zero-config
    discovery falls back to the dev server's service key (`{uid:"service", roles:["admin"]}`,
    `mcp/src/index.ts:261`), and the recommended startup warning naming the credential in use was
    never implemented. The README also documents 26 tools where 40 ship.

## I. Cloud / SaaS control plane

68. **Provisioning & reconcile** — `saas/backend/src/provisioning-reconcile*`, intake→rollout.
    Idempotency, partial-failure recovery, orphaned resources. **partial**
69. **Deploy pipeline** — `deploy-*.ts` (identity, migration, rollback, source guard,
    targets, hooks, duplicate trigger), Kaniko build watch. **partial**
70. **Managed runtime** — `saas/backend/src/managed/*`, contract-version floors, driver
    provisioning floor, rollout gates. **partial**
71. **Tenant isolation & blast radius** — `tenant-isolation.test.ts`, `tenant-hardening.test.ts`,
    network policies, KSA scoping. Hardening branch is unmerged. **partial**
72. **Billing & metering** — `billing-stripe.ts`, `metering/`, webhook idempotency,
    unit economics vs. actual pod cost. **partial**
73. **Kubernetes/infra manifests** — `saas/infra/`, `k8s/`, cloudbuild yamls, Dockerfiles.
    Resource limits, probes, secrets mounting, image provenance. **partial**
74. **Custom domains & TLS** — `verify-domain.ts`, wildcard certs, the cosmetic-badge class. **partial**
75. **Console UI** — `saas/frontend/src`. Docker-era tabs, gating flags, empty states,
    error reporting truthfulness. **partial**
76. **Disaster recovery** — `saas/DISASTER-RECOVERY.md` vs. reality: rehearse the runbook. **done 2026-08-08** — see [audits/76-disaster-recovery.md](audits/76-disaster-recovery.md).

## J. Cross-cutting engineering hygiene

77. **Test suite integrity** — a meta-audit: tests that bypass the wiring (class 3),
    inert type assertions, untypechecked test dirs, mutation-testing survivors,
    two runners in `server-postgres` that can't run together. **partial**
78. **CI gates** — `.github` workflows + `scripts/check-*.mjs`. Which gates actually run
    on which event, ordering (an early failure skipping later gates silently), and which
    "guards" have baselines that only ever grow. **partial**
79. **Logging & observability** — `utils/logger.ts`, `logging.ts`, `request-logger.ts`,
    `metrics/`, `ApiError.expected`. Log levels, PII in logs, cardinality, what's missing
    when something breaks in prod. **done 2026-08-08** — see [audits/79-logging-observability.md](audits/79-logging-observability.md).
80. **Config & env** — `server/src/env.ts`, `boot/env.ts`, `saas/backend/src/env.ts`,
    `validate-config.ts`. Fail-closed on missing/invalid, the collection-key allowlist that
    silently drops unknown keys. **done 2026-08-09** — see [audits/80-config-and-env.md](audits/80-config-and-env.md).
81. **Public API surface & compat policy** — `api-surface/`, `scripts/check-api-surface.mjs`,
    `contracts/derived-names.txt`, `docs/compatibility.md`. What is public, what may change,
    what is frozen. **done 2026-08-05** (surface, [api-surface-audit-2026-08-05.md](api-surface-audit-2026-08-05.md))
    / **done 2026-08-08** (policy, see [audits/81-compat-policy.md](audits/81-compat-policy.md))
82. **Types placement & duplication** — the `WhereFilterOp`-in-two-places class,
    admin-types split, generated SDK copies. **done 2026-07-28**
83. **Performance & scale** — N+1s, work growing faster than input (class 24), pagination
    on large tables, admin table with 100k rows, pool sizing. **partial**
84. **Docs correctness** — `pnpm verify:docs` covers fences; audit what it *cannot* see:
    prose claims, untranslated pages, missing sidebar entries (absent from llms.txt),
    the missing AI/agents section. **partial**
85. **Website** — `website/`, marketing claims vs. shipped features, Lighthouse, legal TODOs. **partial**
86. **Examples & agent skills** — `examples/*`, `rebase-agent-skills/`. Do they run against
    the current version, and do the skills describe the current API? **done 2026-08-08** — see [audits/86-examples-and-skills.md](audits/86-examples-and-skills.md).

---

## Suggested order

*Rewritten 2026-08-09. The previous list — 19, 20, 37, 31, 4, 3, then 63, 50, 49, 64, 79 —
is spent: every unit on it now has a write-up and a merged fix branch.*

The whole OSS data path, schema layer, security layer and admin surface have now had a
dedicated pass. The unaudited frontier is almost entirely **the cloud control plane**,
which is also where a defect has the largest blast radius, since one bug there crosses
tenants rather than rows:

1. **71 (tenant isolation & blast radius)** — the only unit where a failure is
   cross-customer. Nothing else on this list competes.
2. **69 (deploy pipeline)** and **68 (provisioning & reconcile)** — identity, migration
   and rollback on a path that runs against real customer databases.
3. **70 (managed runtime)** — contract-version floors and driver skew, where a wrong
   floor bricks a tenant's boot rather than failing the deploy.
4. **11 (migration ordering)** — the out-of-order-skip class is silent by construction
   and lands in customer schemas.
5. **78 (CI gates)** — a meta-unit: gates that do not run make every other `done` on
   this page weaker than it reads.

Then the remaining data-loss-shaped OSS units: **29** and **30** (storage controllers and
multi-source topology — unit 26 covered authorization, not the controllers underneath),
**10** (introspection round-trip fidelity), and **28** (supply chain).
