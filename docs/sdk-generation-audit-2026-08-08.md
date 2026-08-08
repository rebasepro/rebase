# SDK generation audit — 2026-08-08

Scope: `packages/codegen` (403 LOC), `packages/cli/src/commands/generate_sdk.ts`,
the `/api/meta/contract` endpoint that feeds `--from`, and the coherence of all
three with what the runtime actually serves (`toRestRow`, the Drizzle schema
generator, baas introspection) and with the typed client surface
(`RebaseSdkData`, `SDKCollectionClient`, `FindParams`).

Baseline: `packages/codegen` suite is green (44 tests, 2 suites).

Every finding below was reproduced by running the real generator against
constructed collections and compiling the output with the workspace `tsc`.

---

## Verdict

The security design *around* the generator is genuinely good — the contract
endpoint, the ambient-credential gating and the deserializer are careful, and the
comments show someone thought hard about them. The generator itself is not: it is
string concatenation with no escaping and no identifier discipline, and its core
naming rule contradicts the wire format it is supposed to describe.

Two P0s:

1. **The generated types name columns that do not exist on the wire.** Every
   relation-derived foreign key, and every column in a baas-introspected project,
   is emitted camelCased while the server serves it snake_cased.
2. **Arbitrary TypeScript can be injected into the generated file** via a
   collection slug or an enum value. Demonstrated with a payload that compiles
   clean.

Both are masked in this repo because the only real consumer — the SaaS console —
declares camelCase property keys *and* bypasses the generated types entirely,
using the untyped `data.collection(slug)` accessor.

---

## P0-1 — Generated column names do not match the wire

### The chain

| Step | Location | Result |
|---|---|---|
| FK column name is derived snake_cased | `packages/utils/src/names.ts:27` — `` `${toSnakeCase(singularizeForKey(name))}_id` `` | `project_id` |
| The Drizzle field key **is** `localKey`, verbatim | `packages/server-postgres/src/schema/generate-drizzle-schema-logic.ts:292` | row key `project_id` |
| REST passes row keys through unchanged | `packages/server-postgres/src/services/row-pipeline.ts:221` (`Object.entries(row)`) | JSON key `project_id` |
| Codegen camelCases every key | `packages/codegen/src/generate-types.ts:184` — `toSafeIdentifier(fkKey)` | type says `projectId` |

Same for baas mode: `introspect-runtime.ts:203` sets `properties[col.column_name]`,
so property keys are literal Postgres column names (`created_at`, `author_id`),
and `toSafeIdentifier` renames all of them.

### Proof from the committed SDK

`saas/config/collections/deployments.ts:64` declares a relation with
`relationName: "project"` and no `localKey`. The column is therefore `project_id`.
`saas/frontend/src/generated/sdk/database.types.ts:250` says:

```ts
projectId?: string;
```

There is no `project_id` key anywhere in the generated file.

### Why it is worse than a cosmetic rename

`FindParams<M>` keys `where` and `orderBy` off the row type
(`packages/types/src/controllers/data.ts:80,91` — `FilterValues<FieldPath<M>>`).
So against a generated `Database`:

- `.where({ project_id: ["==", x] })` — correct at runtime — **does not compile**.
- `.where({ projectId: ["==", x] })` — compiles — is a name no column answers to.
- `row.project_id` is a type error; `row.projectId` is `undefined` at runtime.

The `orderBy` case is the nastier one: per `orderBy` hardening a bad sort field is
a 400 now, so it fails loudly — but only after the typed path told the developer
they were right.

The docs contradict the generator directly:
`packages/types/src/controllers/data.ts:91` documents `orderBy: ["created_at", "desc"]`,
and `website/src/content/docs/docs/sdk/index.md` shows
`.orderBy("created_at", "desc")` on a typed client. Neither compiles against a
generated `Database`.

### The behaviour is pinned by tests

`packages/codegen/test/sdk-generator.test.ts:436,467,553` assert
`authorId?: number` for `localKey: "author_id"`. The wrong name is the spec.

### Suggested fix

Emit the **raw key** as a quoted property name whenever it is not a valid
identifier, and never transform it:

```ts
const propName = (k: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k);
```

`toSafeIdentifier` is the right tool for the *collection accessor* (the `Database`
key, which the client maps back through `collectionsDictionary`) and the wrong
tool for anything inside `Row`/`Insert`/`Update`.

---

## P0-2 — Code injection into the generated file

Nothing is escaped. Two interpolation sites take untrusted text:

- `generate-types.ts:13` — `ids.map(v => `"${v}"`)` (string enum values)
- `generate-types.ts:269` — `` `  ${toSafeIdentifier(collection.slug)}: "${collection.slug}",` `` (slug into `collectionsDictionary`)

The slug site is the exploitable one: it is emitted exactly once, so no
brace-balancing across repeats is needed.

**Reproduced.** Slug:

```
posts", OWNED: (globalThis as any).process?.env, x: "
```

Output tail:

```ts
export const collectionsDictionary = {
  postsOwnedGlobalThisAsAnyProcessEnvX: "posts", OWNED: (globalThis as any).process?.env, x: "",
} as const;
```

`tsc --noEmit --strict` on that file: **clean**. The attacker-authored expression
is now a module-level initializer in the developer's app, evaluated on import and
bundled into the client.

The enum site injects too (verified — `export const OWNED = …` appears verbatim in
the output), but the value is emitted three times (Row/Insert/Update), so the two
payloads I tried did not compile. Treat that as payload engineering, not a
mitigation.

### Reachability

- `rebase generate-sdk --from <url>` — slugs come from a remote server. A
  compromised or hostile backend owns the generated file. This is the documented
  cross-repo workflow (`architecture/apps-and-repositories.md`).
- baas mode — slugs derive from table names; Postgres quoted identifiers admit `"`.
- Local source — the developer already controls the file, so no escalation.

### Suggested fix

`JSON.stringify` every interpolated value; validate slugs against
`/^[A-Za-z0-9_-]+$/` and fail generation loudly on anything else.

---

## P1 — Adversarial inputs produce files that do not compile

All reproduced against the real generator, compiled with the workspace `tsc`:

| Input | Emitted | `tsc` |
|---|---|---|
| slugs `my-notes` + `my_notes` | `myNotes` twice | `TS2300` duplicate identifier, `TS1117` duplicate object key |
| slug `2fa_codes` | `2faCodes: {` | `TS1351` identifier cannot follow a numeric literal |
| slug `""` | `: {` | `TS1131` property or signature expected |
| props `my-field` + `my_field` | `myField` twice | `TS2300`, `TS2717` |
| enum value `a"b` | `"a"b"` | `TS1005`, unterminated string |
| enum object key `b"2` | same | same |

The duplicate-slug case is the quiet one: the `collectionsDictionary` object keeps
only the *last* entry at runtime, so even if a developer suppresses the type error,
one collection silently routes to the other's slug.

Nothing in the generator detects a collision. It should: build the identifier set
first, and either disambiguate deterministically or fail with the two slugs named.

---

## P1 — The primary key is optional on every row

`introspect-runtime.ts:193` sets `isId` for a PK and, because of the `else if`,
never sets `validation.required`. Codegen keys optionality off
`validation.required` alone (`generate-types.ts:159`). Result, in the committed
SaaS SDK:

```ts
Row: { id?: string; … }
```

`row.id` is `string | undefined` on every read of every collection. A PK is present
on every row a read can return; it should be unconditionally required in `Row`.

---

## P1 — `Insert` and `Update` carry almost no information

In the real generated file, `Insert` and `Update` are byte-identical to `Row`.
Four separate causes:

1. **Everything is optional anyway** because optionality is driven only by
   `validation.required`, which introspection rarely sets.
2. **`Update` includes the primary key** — `update({ id: "someone-elses" })`
   typechecks. `Update` should omit `isId` properties.
3. **Relation writes are unrepresentable.** Both types `continue` past
   `prop.type === "relation"` (`generate-types.ts:216,244`), so the documented and
   idiomatic write shape — `{ project: id }`, which
   `data-transformer.ts:158` maps onto the FK column — is a type error. Only the
   raw FK column form survives, and it survives under the wrong name (P0-1).
4. **Insert's FK type is a hardcoded `"string | number"`** with a `// simple fallback`
   comment (`generate-types.ts:230`), while `Row` computes the target's real PK type
   via `foreignKeyType()`. So `create({ project_id: "abc" })` compiles against a
   numeric-PK target.

---

## P2 — Nullable columns are typed `?: T` rather than `T | null`

`toRestRow` copies nulls through; the server sends `"col": null`. The generated
type says the key may be **absent**. `row.col?.trim()` survives; `if (row.col !== undefined) row.col.trim()` does not,
and `Object.keys(row)` disagrees with the type. Optional-because-nullable and
optional-because-omitted are different facts and the type conflates them.

---

## P2 — Non-identifier keys are silently renamed, not quoted

`"weird key"` → `weirdKey`. `"a-b"` inside a nested map → `aB`. The column keeps
its real name on the wire; the type describes a field that does not exist and omits
one that does. Same root cause as P0-1, but it bites even camelCase-declaring
projects that have one odd column.

Also: nested map properties ignore `validation` entirely
(`generate-types.ts:40-43`), so every field of an inline map is emitted required.

---

## P2 — `GENERATED_AT` defeats the determinism the command deliberately builds

`generate_sdk.ts:376` sorts collections by slug, with a test pinning it
(`generate_sdk.test.ts` — "sorted by slug for a stable SDK"), specifically so
"regenerating produces the same file for the same schema". Then
`generate_sdk.ts:407` stamps `new Date().toISOString()` into `schema.meta.ts`.

Consequences: every regeneration is a diff; a CI check of the form
`generate-sdk && git diff --exit-code` can never pass; and the `SCHEMA_VERSION`
drift check the file's own comment advertises is the only usable half of it. The
timestamp should go, or move to a file that is gitignored.

Related: the committed `saas/frontend/src/generated/sdk/database.types.ts` is
**stale** — line 251 still emits the old
`{ id; path; __type: "relation" }` envelope, which `includedRelationType` replaced
with an inlined target `Row`. Nothing verifies checked-in SDKs against the current
generator, and the timestamp churn actively discourages regenerating.

---

## P2 — The command's own usage output throws the types away

`generate_sdk.ts:436-443` carries a comment explaining that `rebase.data.…` is the
typed surface and that `collection(slug)` "would advertise the one call shape that
throws away the types this command just generated" — and then prints, as the
headline example:

```
const { data } = await rebase.data.collection('posts').find();
```

`collection<M>(slug)` defaults `M` to `Record<string, unknown>`
(`packages/types/src/controllers/data.ts:917`). The property-style form is printed
second, as a comment, and only when the slug is identifier-like. The generated
`README.md` (`codegen/src/index.ts:52`) leads with the same untyped call and then
does `posts[0].title`.

This is not academic: the SaaS console — the only in-repo consumer of a generated
SDK — uses `rebaseClient.data.collection("apps")` throughout
(`saas/frontend/src/views/project/AppsTab.tsx:65`, `StorageSettings.tsx:111`), i.e.
it imports the generated types and then never uses them. That is why P0-1 has never
been noticed.

---

## P2 — Subcollections are not generated

`contract-routes.ts:65` strips security rules recursively through
`subcollections`, so the contract carries them. `generateTypedefs` iterates the
top-level array only. A project using subcollections gets types for none of them,
silently.

---

## P3 — Packaging

- `@rebasepro/client` is a hard `dependency` of `@rebasepro/codegen` and is
  **never imported** by any file in `src/`. It pulls the whole client and its tree
  into every install of the generator.
- `@rebasepro/common` **is** a real runtime import (`generate-types.ts:2`,
  externalized in `dist/index.es.js`) but is declared only as a `peerDependency` +
  `devDependency`. It works under npm's auto-install-peers, but it is a runtime
  dependency described as an optional contract. Same bug class as the recorded
  `undeclared-runtime-deps-in-published-dist` note.

---

## P3 — Test coverage gaps

`packages/codegen` has 44 tests and they are decent on the happy path. What is not
covered:

- **Nothing typechecks the generated output.** Every P1 above would have been
  caught by one test that runs `tsc` over the result. This is the single highest-value
  addition.
- **The CLI test mocks the generator entirely** (`vi.mock("@rebasepro/codegen")`),
  so `--from`, `resolveSchemaSource`, `fetchRemoteCollections`,
  `mayUseAmbientKey` (the credential-leak guard) and the `schema.meta.ts` stamp
  have **no tests at all**. The credential guard is the most security-relevant code
  in the command.
- No adversarial fixtures: no collision, no non-identifier slug, no quote in an enum.
- `jest.config.cjs` here does typecheck test files via `ts-jest` (unlike other
  packages) but `@types/node` is not wired into the test tsconfig, which is why the
  test dir cannot use `fs`/`path`. Minor, but it blocks writing the tsc-over-output
  test above.

---

## What is well built (do not regress it)

Worth stating plainly, because the surrounding design is markedly better than the
generator core:

- **`/api/meta/contract` is admin-gated, and refuses rather than opens** when no
  auth is configured — 404 with an explicit code, plus a boot warning
  (`init.ts:1780-1798`). `/schema-version` is deliberately unauthenticated,
  returns only a hash, and caches it so polling cannot be turned into CPU
  amplification (`contract-routes.ts:80-85`).
- **`securityRules` and `callbacks` are stripped recursively**, subcollections
  included, with the reasoning written down (`contract-routes.ts:54-70`).
- **`mayUseAmbientKey` compares `origin`, not host** — so an `http://` target for
  an `https://` linked project does not get the service key in cleartext — and it
  refuses to send an ambient key to anything but the linked project, printing a
  dim note when it withholds one (`generate_sdk.ts:243-253, 358-362`).
- **`resolveSchemaSource` validates the URL and rejects non-http(s) schemes**
  before `fetch` sees it.
- **`deserializeCollections` is data-only** — no eval, depth-capped, rehydrates
  `target` into a closure over a slug map (`collection_contract.ts:246-278`).
- **`writeFiles` has no traversal surface**: the file list is a fixed set of
  literals, not derived from input.
- The relation-resolution failure path **warns loudly** rather than silently
  dropping FK columns (`generate-types.ts:139`), and the FK-shadowing union
  (`generate-types.ts:178`) is a genuinely subtle case handled correctly.

---

## Recommended order of work

1. Quote/`JSON.stringify` every interpolated value; validate slugs. (P0-2)
2. Emit raw column keys, quoted when not identifiers; keep `toSafeIdentifier` for
   the `Database` accessor key only. Update the tests that pin the old names. (P0-1)
3. Add a test that compiles the generated output with `tsc` over a fixture set
   that includes the six adversarial inputs above. (catches P1 permanently)
4. Detect identifier collisions and fail with both slugs named. (P1)
5. `Row`: PK always required, nullable columns as `T | null`. (P1/P2)
6. `Update`: omit `isId`. `Insert`/`Update`: accept relation-name writes; use
   `foreignKeyType()` consistently. (P1)
7. Drop `GENERATED_AT`; add a `generate-sdk && git diff --exit-code` CI check and
   regenerate the stale committed SaaS SDK. (P2)
8. Print the typed accessor as the primary usage example, in the CLI and in the
   generated README. (P2)
9. Move `@rebasepro/common` to `dependencies`; drop `@rebasepro/client`. (P3)
