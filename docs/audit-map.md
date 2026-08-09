# Audit map

A register of the units in this repo that are worth auditing **on their own** — one
sitting, one scope, one write-up. The point is not "audit the codebase"; that
produces a shallow pass over everything. The point is that each entry below has its
own failure modes, its own reviewers' questions, and can be declared done.

Status legend:

- **done ‹date›** — a written audit exists; findings tracked or fixed.
- **partial** — covered incidentally inside a broader audit or sweep, never on its own.
- **never** — no dedicated pass.

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

## A. Data path — request to row

1. **Query parser / where-clause contract** — `packages/server/src/api/rest/query-parser.ts`,
   `packages/client/src/query_builder.ts`, `sdk_query_builder.ts`.
   Every operator, on every property type, end to end: does the parser accept what the
   builder emits, does the REST layer forward every parsed param, does an unsupported
   operator 400 rather than silently widen? Prior hits: dropped params, unsorted
   `orderBy` returning 200. **partial**
2. **REST API generator + route surface** — `api/rest/api-generator.ts`, `index.ts`.
   Route-by-route: auth gate present, RLS scope bound, error envelope shape, status
   codes, pagination/count semantics. **partial**
3. **Write validation & coercion** — `api/rest/write-validation.ts`, `data-transformer.ts`.
   Type coercion per property type, rejection vs. clamping (bug class 23), nested/relation
   write shapes, unknown-key handling. **never**
4. **Idempotency** — `api/rest/idempotency.ts`. Key scope, replay window, storage,
   concurrent-duplicate behaviour, what happens on a partial failure. **never**
5. **Relations & junctions** — `server-postgres/src/collections/validate-relations.ts`,
   FK naming, m2m junction generation. Read shape vs. write shape asymmetry, irregular
   plurals, cascade behaviour, orphan rows. **partial**
6. **History / audit log** — `server/src/history/`, `server-postgres/src/history/`.
   Who can read it, what it records, whether it leaks columns RLS would hide. One RLS
   bypass already found here — the sibling routes were never swept. **partial**
7. **Search & vector search** — `schema/search-column.ts`, `client/src/vector-search-query.test.ts`.
   Generated-column immutability, ranking, injection surface, index maintenance. **never**
8. **OpenAPI generator** — `api/openapi-generator.ts`. Does the emitted spec match the
   routes that actually exist, including auth and error responses? **never**

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
    from an older stamped schema. **partial**
13. **Upgrade / version-skew path** — `boot/version-skew.ts`, `schema-version.ts`,
    `scripts/record-schema-snapshot.mts`, upgrade-e2e. Every N→N+1 boot from a real
    snapshot; the FK-rename brick is open. **partial**
14. **Doctor** — `schema/doctor.ts`, `doctor-cli.ts`, `cli/src/commands/doctor.ts`.
    Does each diagnostic fire on a real broken DB, and is its remediation text correct
    (bug class 5)? **never**
15. **Backups & PITR** — `server/src/backup/`, `server-postgres/src/backup/`, `docs/backups.md`.
    Restore actually restores; exclude lists fail closed; PITR cutover. **partial**

## C. Security

16. **RLS policy generation** — `security/rls-enforcement.ts`, `rls-bootstrap-sql.ts`,
    `sqlToPolicy`. Predicate hoisting, unqualified columns binding to the wrong table,
    hashed/injected names, derived junction policies. **partial**
17. **RLS drift & scanning** — `policy-drift.ts`, `packages/rls-check`, `scripts/rls-scan.mts`,
    `rls-baseline.json`. Does the scanner catch what it claims — and what class of hole is
    invisible to it? **partial**
18. **Auth core** — `server/src/auth/routes.ts`, `middleware.ts`, `require-auth.ts`,
    `session-routes.ts`, `jwt.ts`, `password.ts`, `bearer-token.ts`, `cookie-utils.ts`.
    Token lifetime, refresh rotation/reuse detection, cookie flags, session revocation. **partial**
19. **OAuth providers** — 12 provider files (`google-`, `github-`, `apple-`, `microsoft-`,
    `facebook-`, `twitter-`, `linkedin-`, `gitlab-`, `bitbucket-`, `discord-`, `slack-`,
    `spotify-oauth.ts`). One audit, twelve implementations of the same predicate
    (bug class 2): state/PKCE, redirect-URI validation, account-linking, email-verified trust. **never**
20. **MFA** — `mfa.ts`, `mfa-crypto.ts`, `mfa-routes.ts`. Enrolment, recovery codes,
    rate limiting, downgrade-to-password bypass. **never**
21. **Magic links & password reset** — `magic-link-routes.ts`, `reset-password-admin.ts`.
    Token entropy/expiry/single-use, enumeration, the invite-sends-a-reset class. **partial**
22. **Users, roles & admin ops** — `admin-roles-route.ts`, `admin-user-ops.ts`,
    `admin-users-route.ts`, `registration-policy.ts`, `rls-scope.ts`, bootstrap exception.
    Privilege escalation, self-role-grant, the empty-table first-admin path. **partial**
23. **API keys** — `auth/api-keys/*` (6 files). Double gating (permission list + RLS),
    key storage/rotation/revocation, `access: "public"` semantics. **partial**
24. **Rate limiting** — `rate-limiter.ts`, `rate-limit-store.ts`. Header-spoofed client
    identity (X-Real-IP class), per-route coverage, multi-instance correctness. **partial**
25. **Custom & adapter auth** — `custom-auth-adapter.ts`, `builtin-auth-adapter.ts`,
    `adapter-middleware.ts`, `auth-hooks.ts`. Which callbacks are bypassed on which path
    (signups already known to skip before/afterSave). **partial**
26. **Storage authorization** — `storage/routes.ts`, `keys.ts`, path canonicalization,
    signed URLs, per-source authz. **done 2026-08-07**
27. **Secrets & encryption** — `ENCRYPTION_KEY` handling, `crypto-utils.ts`, env-var
    encryption in saas, key rotation story. **partial**
28. **Dependency & supply chain** — `pnpm-workspace.yaml` overrides (bounded?),
    `scripts/check-undeclared-deps.mjs`, published-dist runtime deps, npm trusted publishers. **partial**

## D. Storage

29. **Storage controllers** — `LocalStorageController.ts`, `S3StorageController.ts`,
    `GCSStorageController.ts`. Three implementations of one interface: list/delete/copy
    semantics, error mapping, streaming and memory behaviour. **partial**
30. **Multi-source storage topology** — `storage-registry.ts`, `client/src/storage-registry.ts`,
    `rebase.json` topology, `<BASE>__<KEY>` env suffix, migration between sources. **partial**
31. **Uploads: tus + image transforms** — `tus-handler.ts`, `image-transform.ts`.
    Resumable-upload state, orphan cleanup, transform param validation, decompression bombs. **never**

## E. Realtime, jobs, side effects

32. **Realtime / CDC** — `services/routed-realtime-service.ts`, `server-postgres/src/websocket.ts`,
    `client/src/websocket.ts`, `realtime-channel.ts`. Triggers→pg_notify, RLS-safe refetch,
    the auth race, subscription keys, row identity, reconnect/backfill. **partial**
33. **Channel bus & presence** — opt-in `realtime.bus`; cross-instance correctness when the
    default memory bus is used in a multi-pod deploy. **never**
34. **Offline sync** — `client/src/offline*.ts` (9 files + tests). Conflict resolution,
    codec/version skew, IDB store eviction, replay ordering. **partial**
35. **Cron** — `server/src/cron/*` incl. `scale-to-zero.ts`. Missed-tick semantics,
    overlap/locking across instances, timezone/DST, scale-to-zero vs. due jobs. **partial**
36. **Functions** — `functions/define-function.ts`, `function-loader.ts`, `function-routes.ts`.
    Auth defaults, error surface, loader failure modes, timeout/cancellation. **never**
37. **Webhooks** — `services/webhook-service.ts`. Retry/backoff, signing, at-least-once
    duplication, SSRF on user-supplied URLs. **never**
38. **Email** — `email/smtp-email-service.ts`, `templates.ts`. Template injection, bounce
    handling, deliverability-affecting headers, failure swallowing. **never**

## F. Client SDK & codegen

39. **HTTP transport & client lifecycle** — `client/src/transport.ts`, `client-close.ts`,
    base-URL resolution, retry, abort, auth-refresh overflow. **partial**
40. **Generated SDK** — `packages/codegen`, `cli generate_sdk`. Names are wire names,
    escaping, nullability, relation accessors, regeneration idempotence. **done 2026-08-08**
41. **Typed query contract** — `query-contract.types.ts`. Do the types actually reject
    what the server rejects, and accept what it accepts? Type assertions in tests are
    inert here — check where the contract is really enforced. **never**
42. **client-postgres (direct/PostgREST path)** — `packages/client-postgres`. A second
    implementation of the data path; does it agree with the HTTP client on filters,
    ordering, errors? **never**
43. **server-mongo** — `packages/server-mongo`. Feature parity vs. Postgres, or an honest
    statement of what it does not support. **never**
44. **firebase package** — `packages/firebase`. Still shipped, largely legacy: audit for
    dead surface and drift from current types. **never**

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
    what it can express vs. what the backend accepts, destructive-change guards. **never**
50. **Data import/export** — `admin/src/data_export`, `data_import`. Type fidelity round-trip,
    large-file behaviour, CSV injection, partial-failure reporting. **never**
51. **References & relation pickers** — `ReferenceWidget.tsx`, `RelationSelector.tsx`,
    `ReferenceTable`, `UserSelector.tsx`. Permission-aware listing, pagination, write shape. **never**
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
    correctness on real schemas. **never**

## H. CLI & developer experience

58. **`rebase init`** — `commands/init.ts` + tests. Port probing (the loopback-postgres
    misroute), template correctness, refusal guards, re-run on an existing project. **partial**
59. **`rebase dev` / `start`** — two processes, port reporting, reload, crash surfacing. **partial**
60. **`rebase build` / bundle / fold-static** — `bundle.ts`, `fold-static.ts`, `manifest.ts`.
    Bundle contract vs. runtime expectations, declared deps, reproducibility. **partial**
61. **`rebase db` / `schema`** — push/pull safety, destructive gate, dry-run honesty. **partial**
62. **`rebase cloud`** — `commands/cloud/`. JSON-mode off-TTY, error messages, auth,
    idempotency of deploy. **partial**
63. **`rebase eject`** — does the ejected project actually build and run? **never**
64. **CLI auth, api-keys, apps, telemetry, skills commands** — smaller surfaces, never
    swept together: consent, storage of credentials, what telemetry sends. **never**
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
76. **Disaster recovery** — `saas/DISASTER-RECOVERY.md` vs. reality: rehearse the runbook. **never**

## J. Cross-cutting engineering hygiene

77. **Test suite integrity** — a meta-audit: tests that bypass the wiring (class 3),
    inert type assertions, untypechecked test dirs, mutation-testing survivors,
    two runners in `server-postgres` that can't run together. **partial**
78. **CI gates** — `.github` workflows + `scripts/check-*.mjs`. Which gates actually run
    on which event, ordering (an early failure skipping later gates silently), and which
    "guards" have baselines that only ever grow. **partial**
79. **Logging & observability** — `utils/logger.ts`, `logging.ts`, `request-logger.ts`,
    `metrics/`, `ApiError.expected`. Log levels, PII in logs, cardinality, what's missing
    when something breaks in prod. **never**
80. **Config & env** — `server/src/env.ts`, `boot/env.ts`, `saas/backend/src/env.ts`,
    `validate-config.ts`. Fail-closed on missing/invalid, the collection-key allowlist that
    silently drops unknown keys. **partial**
81. **Public API surface & compat policy** — `api-surface/`, `scripts/check-api-surface.mjs`,
    `contracts/derived-names.txt`, `docs/compatibility.md`. What is public, what may change,
    what is frozen. **done 2026-08-05** (surface) / **never** (policy)
82. **Types placement & duplication** — the `WhereFilterOp`-in-two-places class,
    admin-types split, generated SDK copies. **done 2026-07-28**
83. **Performance & scale** — N+1s, work growing faster than input (class 24), pagination
    on large tables, admin table with 100k rows, pool sizing. **partial**
84. **Docs correctness** — `pnpm verify:docs` covers fences; audit what it *cannot* see:
    prose claims, untranslated pages, missing sidebar entries (absent from llms.txt),
    the missing AI/agents section. **partial**
85. **Website** — `website/`, marketing claims vs. shipped features, Lighthouse, legal TODOs. **partial**
86. **Examples & agent skills** — `examples/*`, `rebase-agent-skills/`. Do they run against
    the current version, and do the skills describe the current API? **never**

---

## Suggested order

If the goal is finding real bugs fastest, the **never**-audited entries with a security or
data-loss blast radius come first: 19 (OAuth ×12), 20 (MFA), 37 (webhook SSRF), 31 (uploads),
4 (idempotency), 3 (write validation). Then the DX-heavy never-audited ones: 63 (eject),
50 (import/export), 49 (collection editor), 64 (small CLI commands), 79 (logging).
