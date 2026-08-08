# Unit 57 — `plugin-ai`, `plugin-insights`, `inference`

*Read-only audit, 2026-08-08. Nothing was modified.*

## Verdict

The three packages in this unit are unrelated in everything but the word "AI",
and they are in very different states. `plugin-ai` is the one that matters: it
is the only code in the repository that sends a user's data to a model
provider, and the security work that has already gone into it is real — no
credential of any kind crosses the boundary, the old hardcoded `fcms-…` key is
gone and is gated by a test, the review dialog means no generated value reaches
a record without someone ticking a box, and `setIn` refuses prototype-chain
paths so a model-chosen key cannot pollute. The credential question, which is
usually where these audits find their worst bug, is genuinely clean. What is
*not* clean is the egress itself: a plugin whose default endpoint is
`https://app.rebase.pro` sends the record's contents and the collection's whole
property schema to a service Rebase runs and then to Google, and it does a `GET
/status` against that host **every time any entity form is opened**, whether or
not anyone ever clicks Autofill. That is disclosed in the package README and
nowhere else — the website's plugin page is three lines and a screenshot — and
there is no opt-in, only an opt-out that a developer has to know exists. Worse,
the two halves of one request disagree about what the record contains: the
client flattens `tags: ["a","b"]` to `tags.0`/`tags.1` while the property map
says `tags`, so the server concludes the field is empty and offers it for
filling. The comment above that code states as an invariant that "there is no
path by which a generated value reaches a field that already had one". For
every array and every date property, there is.

`plugin-insights` contains no AI and no egress at all — it is a scorecard
widget host over developer-supplied `data()` callbacks. Its problems are a
cache that outlives the user it was filled for, three declared config fields
nothing reads, and a documented percent format that is wrong by a factor of a
hundred. `inference` is the oldest code here and shows it: two of its features
are wired to nothing — nested map values are written to `.map` and read from
`.mapValues`, and the `keyValue` map branch is computed and then overwritten on
the next line — and it has no notion of a date at all, so every ISO-8601 column
in every CSV import lands as a plain string.

Cost is bounded but not by anything that measures cost: the "spend ceiling"
counts requests, and one request may be four hundred times the size of another.
The model id (`gemini-3.6-flash`) is current — it appears in the installed
`@google/genai` 2.15.0 surface — so there is no retired-model shipping bug.
There is no "enhance the whole collection" action anywhere; autofill is
per-record only, so the 100k-row question does not arise.

---

## High

### 1. Autofill claims it only fills blanks. For arrays and dates it does not — the two halves of the request use different keys

`packages/plugin-ai/src/utils/values.ts:1`,
`packages/plugin-ai/src/components/DataEnhancementControllerProvider.tsx:134`,
`packages/plugin-ai/src/utils/properties.ts:52`,
`saas/backend/functions/ai.ts:328` (`planFill`), `:312` (`alreadyFilled`)

`getSimplifiedProperties` names an array property by its own path — `tags`.
`flatMapEntityValues` recurses into every `typeof value === "object"`, so the
same record's array becomes `tags.0`, `tags.1`, and a `Date` becomes nothing at
all (`Object.entries(aDate)` is `[]`). Reproduced:

```
{ title: "Hi", tags: ["a","b"], published_at: Date, seo: { title: "S" } }
  → { "title":"Hi", "tags.0":"a", "tags.1":"b", "seo.title":"S" }
```

`published_at` is gone; `tags` is present only under keys the property map has
never heard of. On the server, `planFill` asks `alreadyFilled(values[key])` with
`key === "tags"` — `undefined` — decides the field is empty, and puts it in the
output schema. `propertySchema` happily builds `{type:"array",items:{...}}` for
it, and `{type:"string",format:"date-time"}` for the date.

The comment at `ai.ts:331` is explicit that this cannot happen: *"Enforced by
omission from the schema rather than by asking the model nicely — a field that
is not in the schema cannot be returned, so there is no path by which a
generated value reaches a field that already had one."* The enforcement is
sound; the input it enforces over is wrong.

**Failure scenario.** An editor opens a published blog post with five tags and
a publication date, clicks Autofill to fill the one empty `summary` field. The
model is asked to invent tags and a publication date as well — while being
shown `tags.0: news` in the same prompt, which is also why the invented tags
often duplicate the real ones. Both rows arrive in the review pre-ticked
(`selected: true` is the default at
`DataEnhancementControllerProvider.tsx:169`). The dialog does label them
"replaces the current value", so an attentive operator catches it; a click on
**Apply** without reading replaces the tag list and moves the publication date.

**Fix direction.** One flattening rule for both maps: stop at anything that is
not a plain object — arrays and `Date` are leaf values, not containers — so
`values` is keyed exactly like `properties`. A test that asserts
`Object.keys(values) ⊇ Object.keys(properties that have a value)` is what keeps
the two halves from drifting again.

### 2. Every entity-form open contacts `app.rebase.pro`, and record contents leave by default

`packages/plugin-ai/src/api.ts:17`,
`packages/plugin-ai/src/components/DataEnhancementControllerProvider.tsx:105`,
`:145`, `packages/plugin-ai/src/useDataEnhancementPlugin.tsx:24`,
`website/src/content/docs/docs/plugins/index.md:100`

`DEFAULT_AI_ENDPOINT` is `https://app.rebase.pro/api/functions/ai`. The
provider is form-scoped, so mounting the plugin means one `GET /status` to that
host *per entity form opened*, before any user action. On Autofill, the request
body carries the collection's whole simplified property map (names,
descriptions, enum values) and the flattened record.

Two separate things are wrong here.

*The ping.* Opening a record is not asking for AI. Every self-hosted install
that mounts this plugin reports its existence, its IP and its editing cadence
to Rebase on every form open, with no user-visible signal and no way to keep
the button while suppressing the beacon.

*The disclosure.* `packages/plugin-ai/README.md:47` says it plainly and well —
"Your collection schema and the record's current values are sent". That text
exists in exactly one place. The website's plugin documentation
(`plugins/index.md:100–112`, and its five translations) is a heading, two lines
of import, and a screenshot; it does not mention that data leaves the machine,
does not name Google as the sub-processor, and does not mention `endpoint`. A
developer who reads the docs site rather than the npm README — the ordinary
case — never learns any of it.

**Failure scenario.** A team installs the admin panel over a Postgres database
of patient intake forms, mounts the plugin because the docs list it under
"Built-in Plugins", and every record their staff open is POSTed to a
third-party control plane and forwarded to Gemini the first time anyone tries
the button. Nobody in that team ever saw a sentence saying so.

**Fix direction.** The docs page is the cheap half: state the egress, name the
provider, show `endpoint`, and show `getConfigForPath` returning `false`. The
harder half is the default — either make `endpoint` required (an explicit act,
which is what an opt-in is), or make the status probe lazy so that an install
that never clicks Autofill never contacts the host.

### 3. Values of `readOnly` and `disabled` properties are sent to the model

`packages/plugin-ai/src/utils/properties.ts:34`,
`packages/plugin-ai/src/components/DataEnhancementControllerProvider.tsx:134`,
`saas/backend/functions/ai.ts:355` (`describeValues`), `:371`

The property map marks `admin.readOnly` / `admin.disabled` fields as
`disabled`, and the server correctly refuses to *fill* them
(`propertySchema:271`). But `values` is built from the entire form record with
no filter, and `describeValues` deliberately includes every key it is given —
`void keys;` at `ai.ts:371`, with the comment "Keys not in the fill set still
matter as context". So a field the schema says the model may not touch is still
placed in the prompt.

**Failure scenario.** A collection has `internal_risk_notes` and
`stripe_customer_id` marked `admin: { readOnly: true }` because they are
written by a backend hook and must not be edited. An editor clicks Autofill on
a blank `description`. Both read-only values are transmitted to the control
plane and pasted into the prompt sent to the provider.

**Fix direction.** `disabled` should mean "not fillable **and** not context",
or at minimum the client should filter values for disabled keys before
sending — the client is where the collection config actually lives, so it is
the honest place to make the decision.

### 4. `getConfigForPath` is documented and typed to receive `user`, and never does

`packages/plugin-ai/src/useDataEnhancementPlugin.tsx:18`,
`packages/plugin-ai/src/components/DataEnhancementControllerProvider.tsx:22`,
`:93`, `packages/plugin-ai/README.md:69`

The public prop type declares `(props: { path, collection, user: User | null })
=> boolean`. The provider's own copy of that type declares `{ path, collection }`
and calls it with `getConfigForPath({ path, collection })`. The two never have
to agree because `useDataEnhancementPlugin` hands the provider through as
`React.ComponentType<any>` (`:60`), which erases the mismatch. `user` appears
nowhere else in the package. Bug class 21, with a security consequence.

**Failure scenario.** An operator restricts autofill to a role:
`getConfigForPath: ({ user }) => user?.roles?.includes("editor")`. `user` is
`undefined`, the expression is `undefined`, `Boolean(undefined)` is `false`, and
the feature is silently off for everyone including editors — the fail-closed
direction, so it reads as "the plugin is broken". Write it the other way —
`({ user }) => !user?.roles?.includes("intern")` — and it is `true` for
everyone, including the interns it was meant to exclude. The destructure
`({ user }) => user.roles` simply throws inside a `useEffect`.

**Fix direction.** Either thread the auth controller's user into the provider
and pass it, or delete `user` from the public type and the README. The silence
is the bug; which way it is resolved is a product call.

### 5. A truncated or unparseable autofill stream is reported as a successful, empty run

`packages/plugin-ai/src/api.ts:159`, `:163`,
`packages/plugin-ai/src/components/DataEnhancementControllerProvider.tsx:187`,
`packages/plugin-ai/src/components/AutofillReviewDialog.tsx:111`

`autofillStream` iterates SSE records and returns whatever it has when the body
ends. A malformed `data:` payload is skipped with a bare `continue` — correct in
isolation, deliberately so — but there is no requirement that a `done` event
ever arrived. If the connection drops mid-stream, or a proxy truncates it, or
every record fails to parse, the loop simply ends, `result` stays
`{ suggestions: {} }`, and the caller sets `status: "ready"` with the pending
rows filtered out. The dialog then renders its zero-field branch:

> "Nothing to fill in — every field either already has a value the model would
> not improve on, or is not one it can write."

**Failure scenario.** The pod serving the stream is rolled mid-generation. The
operator is told, in a confident sentence, that their empty `summary`,
`meta_description` and `excerpt` fields are all fields the model would not
improve on. They believe it and stop trying. Nothing is logged; the failure is
indistinguishable from the success case.

**Fix direction.** Track whether a `done` record was seen and treat its absence
as a failure (`status: "failed"`, "the stream ended early — this is what was
written before it stopped"), which is the branch the UI already has. Count
skipped-malformed records too: zero good fields plus n discarded records is not
"nothing to fill".

---

## Medium

### 6. The spend ceiling counts requests, not spend

`saas/backend/functions/ai.ts:95`, `:118`, `:473`, `:589`, `:662`

`claimQuota()` decrements a single integer. A `/prompts` call with a 20-character
entity name and a `/autofill` call carrying 200 properties, 60,000 characters of
values and an 8,192-token output budget cost the same one unit. The ratio
between the cheapest and most expensive admissible request is on the order of
several hundred.

**Failure scenario.** A script sends maximum-size `/autofill` bodies at the
rate limit. It consumes the "5,000 requests" budget while spending what tens of
thousands of normal requests would have — and the free tier is out for the
UTC day either way.

**Fix direction.** Charge the counter by `usage.inputTokens + outputTokens`
after each generation (the value is already captured at `ai.ts:196`), with a
pessimistic pre-charge for the request that has not completed yet.

### 7. One IP can drain the entire global daily budget in about ninety minutes

`saas/backend/src/index.ts:133`, `saas/backend/src/utils/rate-limit.ts:178`,
`saas/backend/functions/ai.ts:95`

The limiter keys on `${clientIp}:${c.req.path}`, so 20/minute is **per path**,
not per service: `/autofill`, `/autocomplete` and `/prompts` each get their own
bucket, giving one address 60 paid generations a minute. Against a 5,000/day
global ceiling that is roughly 83 minutes to exhaustion. The counters are also
process-local, so the ceiling is really *5,000 × replicas* and `/status` may be
answered by a replica with budget while `/autofill` lands on one without.

**Failure scenario.** A single unauthenticated caller — no signup, no key, no
identity of any kind — turns Autofill off for every Rebase install on the
internet before lunch. Everyone else's admin panel just stops showing the
button, with no message.

**Fix direction.** Key the AI limiter on the IP alone rather than IP+path so
the 20/minute is a service budget; and since `isAvailable()` already gates the
UI, a shared counter (the control plane has Postgres) is what makes the
ceiling mean what the comment says it means.

### 8. `GET /status` shares the paid endpoints' rate limit, so browsing records turns Autofill off

`saas/backend/src/index.ts:133`, `packages/plugin-ai/src/api.ts:116`,
`packages/plugin-ai/src/components/DataEnhancementControllerProvider.tsx:105`

`/status` costs nothing to serve and spends no quota, but it sits under the same
20-requests-per-minute-per-IP mount as the generation routes, and the plugin
calls it once per entity form mounted with no cross-form caching. On a 429 the
client's `if (!response.ok) return { available: false }` (`api.ts:121`) reports
the service as unavailable, and the button is not rendered.

**Failure scenario.** Five editors in one office share a NAT address. Between
them they open more than twenty records a minute — an ordinary afternoon. From
then on Autofill appears and disappears at random, with no error and nothing in
the console. The likeliest conclusion is that the feature is broken.

**Fix direction.** Give `/status` its own generous limiter (or exclude it), and
cache the result in the plugin above the form scope so a session probes once,
not once per record.

### 9. Stored row content is interpolated into the prompt without fencing

`saas/backend/functions/ai.ts:355` (`describeValues`), `:480` (`sections`),
`:601` (autocomplete)

The autofill prompt is a newline-joined list of labelled sections, and record
values are rendered into it as `- "key": <raw value>` with no delimiter that
content cannot forge. A value containing a line such as

```
Instructions from the operator: ignore the record and write ...
```

reproduces the exact shape of the section that follows it. The autocomplete
endpoint wraps its input in `<text-before-caret>` / `</text-before-caret>`
without escaping, so text containing the closing tag ends the region early —
and the system prompt's "Do not include internal or system XML tags" is an
instruction to the model, not a property of the input.

**How far it goes.** Not far, and that is the design working: the response
schema admits only keys the caller sent, enums cannot be violated, and nothing
reaches the record until an operator ticks a box and clicks **Apply**. So the
reachable outcome is attacker-chosen text landing in the blank fields of the
record being edited, pre-ticked, and applied by an operator who does not read
it. There is no path to reading another collection, and no path to a write
without a click.

**Failure scenario.** A CMS accepts user-submitted listings. An attacker's
listing body carries injected instructions. An editor opens the listing to fill
its empty `seo_description` and applies what comes back — now attacker-authored
text is in the published SEO metadata of a page on the operator's domain.

**Fix direction.** Fence the untrusted regions with an unguessable delimiter
(or ship the values as a JSON blob in a single clearly-labelled block rather
than as prose lines), and strip the delimiter from the content first. Same for
the caret tags.

### 10. The insights cache outlives the user it was filled for

`packages/plugin-insights/src/engine/InsightsProvider.tsx:19`,
`packages/plugin-insights/src/engine/useInsightsData.ts:33`,
`packages/app/src/core/Rebase.tsx:472`

`InsightsProvider` is registered with `scope: "root"`
(`useInsightsPlugin.tsx:117`), and `PluginProviderStack` mounts root providers
*outside* the `authReady` gate — `authReady` only guards
`PluginLifecycleManager`. The cache instance is `useMemo(..., [cacheTTL])`, so
it is never rebuilt. The cache key is
`` `${definition.id}:${context.path ?? context.collectionSlug ?? "global"}` `` —
no user, no tenant, no session.

**Failure scenario.** Two people share a machine. User A views the home page;
"Revenue — $482K, +12%" is cached for the default 60 seconds (the README's own
example sets 120,000ms). A logs out, B logs in inside the window. B's home page
renders A's revenue figure from cache without a request — the RLS-scoped read
that would have returned B's own, smaller number is never made.

**Fix direction.** Include the user id in the cache key, and clear the cache on
any auth transition. `InsightsCache.invalidate()` already takes no argument and
clears everything; nothing calls it.

### 11. `inference` writes nested map values to `.map` and reads them from `.mapValues`

`packages/inference/src/collection_builder.ts:190`, `:205`, `:208`, `:301`,
`packages/inference/src/types.ts:22`

`increaseValuesCount` declares its record with a local inline type whose field
is `map?: ValuesCountRecord` and writes `valuesRecord.map = mapValuesRecord`.
`buildPropertyFromCount` reads `valuesResult.mapValues` — the name declared in
`types.ts`. The local inline type is what makes this compile: it shadows
`ValuesCountEntry` at the write site, so the two names never meet in one
declaration. `mapValues` is therefore always `undefined`.

**Failure scenario.** A CSV imports with a nested `address` column. Every field
under it — `address.country` with six repeated values, `address.avatar_url`
pointing at `.png` files, a field present in every row — is built with
`valuesResult: undefined`, so `buildStringProperty` and `buildValidation` take
their early-return paths. No enum is inferred, no `url`/`email` flag, no storage
config, no `required`. Top-level columns get all of it; nested ones get bare
strings, and the reason is invisible.

**Fix direction.** One name. `types.ts` is the declaration, so write
`valuesRecord.mapValues`, delete the inline type at `:190` and annotate with
`ValuesCountEntry` so the compiler owns the agreement from then on.

### 12. The `keyValue` map branch is computed and immediately thrown away

`packages/inference/src/collection_builder.ts:288`

```ts
if (mostProbableType === "map") {
    const highVariability = checkTypesCountHighVariability(typesCount);
    if (highVariability) {
        result = { type: "map", name: …, keyValue: true, properties: {} };
    }
    const properties = buildPropertiesFromCount(…);
    result = { type: "map", name: …, properties };   // ← unconditional
}
```

The `highVariability` assignment is overwritten on every path.
`checkTypesCountHighVariability` — 11 lines of ratio arithmetic — decides
nothing. Bug class 20.

**Failure scenario.** A `metadata` column holds free-form key/value objects,
different keys in nearly every row. The heuristic exists precisely to describe
that as a `keyValue` map. Instead every key that ever appeared becomes a named
sub-property, so importing 5,000 rows produces a collection with hundreds of
one-row string fields.

**Fix direction.** `return` the `keyValue` property inside the branch. Then a
test with high-variability fixture data proves the branch is reachable — there
is currently none, which is why the overwrite survived.

### 13. Nothing in `inference` ever infers a date

`packages/inference/src/builders/string_property_builder.ts` (whole file),
`packages/inference/src/collection_builder.ts:415`,
`packages/admin/src/data_import/utils/get_import_inference_type.ts:24`

`buildStringProperty` tests for URLs, emails, 28-character ids, enums and media
file extensions. It has no date test. `inferTypeFromValue` returns `"date"`
never — a JS `Date` reaches `typeof value === "object"` and is classified
`"map"`. The one piece of code written for the problem, `isUnixTimestamp` at
`get_import_inference_type.ts:24`, is defined below the only export in its file
and called from nowhere in the repository.

**Failure scenario.** A CSV of orders with `created_at`, `shipped_at` and
`due_date` in ISO-8601. All three infer as `string`. The generated collection
stores them as text, so ordering is lexicographic-by-luck, date filters are
unavailable, and the operator has to change three property types by hand in the
import mapping UI — for every import.

**Fix direction.** A date test in `buildStringProperty` in the same shape as the
existing ones: if more than two-thirds of sampled values parse as a date *and*
match a date-like pattern (a bare `Date` parse accepts far too much), emit
`{ type: "date" }`. And either wire `isUnixTimestamp` in or delete it.

---

## Low

### 14. `InsightContext.parentEntityIds` is declared, documented, plumbed — and never populated

`packages/plugin-insights/src/types/engine.ts:8`,
`packages/plugin-insights/src/components/InsightWidget.tsx:41`, `:53`

The context type documents `parentEntityIds` as "The parent entity IDs if this
is a subcollection". `CollectionInsightsInline` passes the prop down;
`InsightWidget` destructures it and then builds
`{ path, collectionSlug, parentCollectionSlugs }` without it. The plugin's own
comment (`useInsightsPlugin.tsx:87`) states as fact that "`InsightContext`
carries no parent entity id" — the type says otherwise, in six lines of
docblock. Bug class 21. A developer writing `data: ({ parentEntityIds }) => …`
gets `undefined` and an unscoped aggregate.

### 15. `InsightDefinition.description` is read by nothing

`packages/plugin-insights/src/types/engine.ts:35`

Declared as "Optional description"; `description` appears in no component. Class
21, harmless but advertised.

### 16. Only `rows[0]` is ever used

`packages/plugin-insights/src/components/InsightWidget.tsx:91`

`InsightDataResult` is `{ rows: DataRow[] }` and the README's example is
`find({ limit: 1000 })`. Every row after the first is fetched, transferred,
cached and discarded. Either the type should be a single row, or the docs should
say `limit: 1`.

### 17. The documented `percent` format is wrong by 100×

`packages/plugin-insights/src/types/widgets.ts:19`,
`packages/plugin-insights/src/components/InsightsScorecardView.tsx:26`,
`packages/plugin-insights/README.md` (quick start)

The docblock says `` `percent`: 12.5% `` and the README example is
`{ field: "delta_pct", format: { style: "percent", decimals: 1 } }`.
`Intl.NumberFormat` with `style: "percent"` multiplies by 100, so a field named
`delta_pct` holding `12.5` renders as **1,250.0%**. Copying the documented
example produces a wrong number on a KPI card. Either document that the input
must be a fraction, or divide by 100 for that style.

### 18. The rate limiter's 429 does not use the error envelope the client parses

`saas/backend/src/utils/rate-limit.ts:190`, `packages/plugin-ai/src/api.ts:97`

The limiter returns `{ error: "Too many requests, please try again later." }` — a
string — while `fail()` and every other route return `{ error: { code, message } }`.
`errorFrom` reads `body?.error?.message`, gets `undefined`, and falls back to
"The AI service could not complete this request." So the one error with a clear
remedy ("wait a minute") is the one shown as generic.

### 19. `getSimplifiedProperty` writes a raw string where an `InputProperty` is expected

`packages/plugin-ai/src/utils/properties.ts:108`

```ts
[`${path}.${i}.${typeKey}`]: oneOfType,   // a string, in a Record<string, InputProperty>
```

The server skips it (`ai.ts:329` rejects non-objects), so nothing breaks today.
Client-side, `getPropertyFromKey` can return that string and `coerceToProperty`
reads `.type` off it — `undefined`, so a date value at such a path would not be
converted. The type says this cannot happen because the object literal is built
by `.reduce` into an untyped accumulator.

### 20. `buildPropertyFromData` throws on empty input when the property has an enum

`packages/inference/src/collection_builder.ts:51`

```ts
const newEnumValues = extractEnumFromValues(Array.from(valuesCount["inferred_prop"].valuesCount.keys()));
```

`valuesCount["inferred_prop"]` is only created inside the `data.forEach`, so an
empty `data` array makes this a `TypeError` on `undefined`. Reached from
`CollectionEditorImportMapping.tsx:124` — a file with headers and no data rows
crashes the import mapping dialog instead of showing an empty mapping.

### 21. Two inference entry points disagree about `Date`, under a comment asserting they agree

`packages/inference/src/collection_builder.ts:415`,
`packages/admin/src/data_import/utils/get_import_inference_type.ts:1`

`getInferenceType` returns `"date"` for a `Date`; `inferTypeFromValue` returns
`"map"`. The comment at `get_import_inference_type.ts:5` says "the two entry
points into inference have to agree", and they were reconciled for `null` only.
Currently benign — all three `@rebasepro/inference` call sites pass
`getInferenceType`, and the one consumer of `inferTypeFromValue`
(`processValueMapping`) falls through every branch for a `Date` and returns the
value unchanged, which is accidentally right. Bug class 2; it will bite whoever
adds a `date → x` conversion branch.

### 22. Stale compiler-error dumps from an unrelated project are tracked in `plugin-insights`

`packages/plugin-insights/errors.txt`, `tsc_errors.txt` (both tracked),
`tsc_output.txt` (untracked)

233 lines of `tsc` output referring to `DatakiLogin.tsx`,
`DashboardHistoryView.tsx`, `DataSourcesSelection.tsx`, `ChatSessionItem` —
files that do not exist in this repository. Leftovers from whatever the package
was forked from, naming a third-party product. They are outside `files: ["dist",
"src"]` so they do not ship to npm, but they are in the public repository.

### 23. The scaffold installs `@rebasepro/plugin-ai` and never uses it

`packages/cli/templates/template/frontend/package.json:8`,
`packages/cli/templates/template/frontend/src/App.tsx`

The template's `App.tsx` mounts no plugins; the dependency is installed for
nothing. Benign for privacy (an unmounted plugin sends nothing) but it is a
package in every scaffolded project's install and lockfile that no code
imports.

### 24. `loading` is permanently `true` when auth never becomes ready

`packages/plugin-insights/src/engine/useInsightsData.ts:30`, `:36`

`useState(true)` and an early `return` when `!authReady || !cache`. In a panel
where the user is not signed in and `loginSkipped` is false, every insight
widget renders its skeleton forever rather than rendering nothing.

### 25. A developer-supplied `data()` error is rendered verbatim to any admin user

`packages/plugin-insights/src/components/InsightWidget.tsx:71`

`{error.message}` goes straight into the card. React escapes it, so this is not
XSS, but a rejected `rebaseClient` call carries the server's message — a
Postgres error string, a failing SQL fragment — onto the home page of anyone
with access to the panel.

---

## Checked and clean

- **No API key can reach a browser bundle.** `packages/plugin-ai/src` contains no
  `apiKey`, no `import.meta.env`, no `process.env`, no bearer token. The provider
  key is read only in `saas/backend/functions/ai.ts:134`, server-side, and never
  echoed. `api.test.ts:199` and `useDataEnhancementPlugin.test.tsx:53` assert the
  request carries no `fcms-`, `Bearer` or `Basic` — a real gate, not a comment.
- **Model ids are current.** `gemini-3.6-flash` (`ai.ts:57`) appears verbatim in
  the installed `@google/genai` 2.15.0 type surface alongside `gemini-3.5-flash`
  and `gemini-3.1-*`. `AI_MODEL` overrides it without a deploy. No retired id
  ships. (Two Claude ids appear as `/status` fixtures in tests only.)
- **No bulk enhance exists.** The plugin registers one slot, `form.actions`
  (`useDataEnhancementPlugin.tsx:52`). There is no collection-level or
  multi-select autofill anywhere in the repository, so "enhance the whole
  collection" cannot be invoked on a 100k-row table.
- **No cross-collection egress.** `values` comes from `formContext.values` — the
  record the user has open, already through RLS — and `properties` from that one
  collection's config. Nothing reads a second collection, and there is no
  service-role read anywhere in the plugin.
- **A model-chosen key cannot pollute the prototype.** `applyReview` writes
  through `formContext.setFieldValue` → `setIn`, which rejects `__proto__`,
  `constructor` and `prototype` segments (`packages/forms/src/utils.ts:122`).
- **Nothing is written without a human.** Streaming touches only review state;
  `applyReview` (`DataEnhancementControllerProvider.tsx:232`) is the single write
  path, it skips unticked and pending rows, and it produces one dirty transition
  rather than one per token.
- **Half-written fields are not offered.** Both the success and failure paths
  filter `pending` rows out of the review (`:196`, `:209`), so a truncated string
  can never be applied.
- **Fields the schema forbids stay forbidden.** `propertySchema:271` drops
  `disabled` properties, and `scalarSchema` excludes `reference`, `relation`,
  `vector`, `geopoint` and `binary` — so no fabricated foreign key can be
  proposed.
- **SSE framing is correct.** `readServerSentEvents` buffers to a blank line and
  uses `exec` to learn the separator's true length, so a `\r\n\r\n` boundary
  straddling two reads does not corrupt the next record. `SSE_SEPARATOR` is
  deliberately non-global so `lastIndex` cannot leak between calls.
- **Request-shape caps exist and are enforced.** `MAX_PROPERTIES`,
  `MAX_VALUE_ENTRIES`, `MAX_VALUES_CHARS`, `MAX_VALUE_LENGTH`,
  `MAX_INSTRUCTIONS_LENGTH`, `MAX_AUTOCOMPLETE_CONTEXT` and three output-token
  ceilings all apply before the provider is called. The caps are on the record,
  not just per value — the harder half, and it is there.
- **The `X-Forwarded-For` bypass is closed.** `clientIpFor`
  (`rate-limit.ts:118`) counts from the right by trusted-hop count and returns a
  shared `UNATTRIBUTED_KEY` when the chain was not traversed, rather than
  falling back to a client-controlled value.
- **`plugin-insights` sends nothing anywhere.** No `fetch`, no endpoint, no
  provider; every request is the developer's own `data()` callback.
- **All three insights slots have render sites.** `home.children.start`
  (`ContentHomePage.tsx:316`), `home.card.insight`
  (`NavigationCardBinding.tsx:79`) and `collection.insights`
  (`CollectionViewBinding.tsx:515`), and the props each `useSlot` passes match
  the declared interfaces in `admin-types/src/types/slots.tsx`.
- **Relation-scoped views are correctly skipped.** `useInsightsPlugin.tsx:87`
  returns `null` when `parentEntityIds` is non-empty, so a collection-wide total
  is not rendered over one parent's two rows.
- **Both plugin packages do run their tests.** Neither has a `jest.config.cjs`,
  which looks like the `packages/firebase` gap, but both carry a full `jest` key
  in `package.json` (ts-jest transform, jsdom for `plugin-ai`, workspace
  `moduleNameMapper`). The suites execute. Note that `plugin-insights` sets
  `diagnostics: false`, so type errors in its tests are not errors.
- **`inference` handles all-null columns sensibly.** The key is registered by
  `increaseMapTypeCount` before the null check, then `getMostProbableType({})`
  returns its `"string"` default and `buildValidation` correctly declines to mark
  it `required`.
- **`buildPropertiesOrder` respects a caller-supplied order** and no longer
  sorts the caller's array in place (`collection_builder.ts:93`).

---

## Open questions

1. **Is `app.rebase.pro/api/functions/ai` live with a key set?** Everything in
   this audit is read from source. If `GEMINI_API_KEY` is unset in the deployed
   control plane, `isAvailable()` is `false`, no button renders anywhere, and
   the entire egress surface is currently dormant — which changes the urgency of
   findings 2 and 3 but not their correctness.
2. **Is there a data-processing agreement covering this?** The plugin makes
   Rebase a processor for every install that mounts it, and Google a
   sub-processor. `SECURITY.md` and the site's legal pages were not read as part
   of this unit.
3. **How many replicas does the control plane run?** The daily ceiling is
   process-local, so the real global cap is `5000 × replicas` and the number is a
   deployment fact, not a code fact.
4. **Was `keyValue` map inference ever working?** Finding 12 has no test, so it
   is not clear whether the overwrite is a regression or whether the branch was
   never returned from. `git log -L` on `buildPropertyFromCount` would settle it.
5. **Should `plugin-insights` exist at this fidelity?** It renders exactly one
   widget shape (a scorecard) from exactly one row, with three declared fields
   nothing reads. Whether the gaps are bugs or an unfinished feature is a product
   question, but the declared-and-unread ones should be marked either way.
6. **Does `parentEntityIds` want implementing or deleting?** The plugin's comment
   and its type contradict each other, so someone has already had this argument
   with themselves.
