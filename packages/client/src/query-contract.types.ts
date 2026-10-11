/**
 * Compile-time assertions about the query surface.
 *
 * ## Read this before adding a `.test.ts` for a type
 *
 * These assertions are **not** in a test file, on purpose. In this repo a jest
 * test cannot check a type at all:
 *
 * - `ts-jest` is configured transpile-only. Verified: a test containing
 *   `const n: number = "nope"` passes. `@ts-expect-error` in a `.test.ts` is
 *   therefore inert — it asserts nothing and never fails.
 * - `tsconfig.typecheck.json` — the gate CI runs as `pnpm run typecheck` —
 *   covers every package's `src` directory but **excludes every `*.test.ts`**.
 *
 * So a type assertion written as a test is checked by nothing, twice over. This
 * file is a plain module under `src`, which is exactly what the gate does read.
 * It is imported by nothing and emits no runtime code.
 *
 * ## What went wrong that this exists to prevent
 *
 * `_score` was accepted by the runtime, documented in the SDK docs and skills,
 * and rejected by `orderBy`'s type, which was `keyof M`. On a project with a
 * generated SDK — where `M` is a concrete row type — the documented call was a
 * compile error. Nothing in this repo noticed; a downstream application did.
 */
import type { AggregateParams, FindParams, FindResult, LogicalCondition, SDKCollectionClient, SDKQueryBuilderInterface, UpdateValues, WhereFilterOp } from "@rebasepro/types";
import { and, cond, not, or } from "@rebasepro/common";

/**
 * A row shaped the way a **generated** SDK shapes one: a type alias with a
 * finite key set.
 *
 * This detail is the whole test. An `interface … extends Record<string,
 * unknown>` also satisfies the constraint, but its index signature makes
 * `keyof M` collapse to `string` — so every assertion below would pass no
 * matter what `orderBy` accepted, typos included. That is how the first draft
 * of this file was written, and every `@ts-expect-error` in it reported
 * "unused directive": the fixture proved nothing.
 *
 * A generated row type has no index signature, which is exactly why a real
 * project caught what this repo did not.
 */
type ContractRow = {
    id: string;
    title: string;
    created_at: string;
    /** An `array` property, which codegen emits as `Array<X>`. */
    tags: string[];
    age: number;
    deleted_at: string | null;
    /** A `vector` property. */
    embedding: number[];
    /** An `enum` property, which codegen emits as a union of literals. */
    status: "draft" | "published";
};

/** A to-many relation, which codegen emits as `Array<TargetRow>`. */
type TagRow = { id: string; label: string };
type PostRow = { id: string; title: string; tags: TagRow[] };

// ── orderBy accepts relevance, and still rejects nonsense ───────────────────

/** The documented relevance sort must compile. */
export const orderByScore: FindParams<ContractRow> = {
    searchString: "auditor",
    orderBy: ["_score", "desc"]
};

/** An ordinary column must keep compiling. */
export const orderByColumn: FindParams<ContractRow> = { orderBy: ["created_at", "desc"] };

/**
 * A column that does not exist must still be refused. Widening `orderBy` to
 * `string` would have fixed the `_score` error and silently given up this,
 * turning every typo into an unsorted 200 in production.
 */
// @ts-expect-error - "nope" is neither a column of ContractRow nor computed
export const orderByTypo: FindParams<ContractRow> = { orderBy: ["nope", "desc"] };

// ── the fluent builder agrees with FindParams ──────────────────────────────

export const fluentScore = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.search("auditor").orderBy("_score", "desc");

export const fluentColumn = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.orderBy("created_at", "asc");

export const fluentTypo = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - the fluent signature must reject what FindParams rejects
    qb.orderBy("_scoer", "desc");

/** Vector search must be reachable from the builder, and chain. */
export const fluentVector = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.vectorSearch("embedding", [0.1, 0.2], { threshold: 0.3 }).limit(10);

// ── the operator decides what the value is ─────────────────────────────────

/**
 * `array-contains` takes an **element** of the column, not the column.
 *
 * This was the second `_score`: documented in `docs/sdk/querying.md`, accepted
 * by the runtime, and a compile error on a generated SDK — because
 * `WhereValue<T> = T | T[] | null` was one value type for all sixteen
 * operators, so on `tags: string[]` it wanted a `string[]`. The spelling that
 * did compile, `["featured"]`, builds `@> ARRAY[$1]` with the whole array bound
 * as the single element and matches nothing, forever, with no error anywhere.
 */
export const fluentArrayContains = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("tags", "array-contains", "featured");

export const fluentArrayContainsWrapped = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - the column is not one of its own elements
    qb.where("tags", "array-contains", ["featured"]);

/**
 * Same defect, and the case the relation compiler was specifically built for:
 * a to-many relation is emitted as `Array<TargetRow>`, and the compiler answers
 * `array-contains` on it by comparing **ids**. So the id must be accepted even
 * though it is not the element type.
 */
export const fluentRelationContains = (qb: SDKQueryBuilderInterface<PostRow>, tagId: string) =>
    qb.where("tags", "array-contains", tagId);

export const fluentRelationIn = (qb: SDKQueryBuilderInterface<PostRow>, tagIds: string[]) =>
    qb.where("tags", "in", tagIds);

export const fluentRelationTypo = (qb: SDKQueryBuilderInterface<PostRow>) =>
    // @ts-expect-error - neither a `TagRow` nor a `TagRow["id"]`
    qb.where("tags", "array-contains", 42);

/** The list operators take a list of elements — or one, read as a one-element list. */
export const fluentInList = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("tags", "in", ["featured", "new"]);

export const fluentInScalar = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("title", "in", "hello");

export const fluentInNested = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - a list of lists is not a list of elements
    qb.where("tags", "in", [["featured"]]);

/** A comparison takes one value. `eq(column, ["a","b"])` is not a query anyone meant. */
export const fluentEqArray = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - `==` compares against a value, not a list
    qb.where("title", "==", ["a", "b"]);

/**
 * A pattern is a string on every column type. The driver casts, so refusing
 * `"%3%"` on a numeric column was the type being stricter than the runtime.
 */
export const fluentLikeOnNumber = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("age", "like", "%3%");

/** The null operators ignore their value; `null` is the conventional spelling. */
export const fluentIsNull = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("deleted_at", "is-null", null);

/**
 * A caller holding an unnarrowed operator — a dynamic filter UI — must keep
 * compiling. `WhereValueFor` distributes over the operator, so this is the
 * union of every branch rather than a `never`.
 */
export const fluentDynamicOp = (qb: SDKQueryBuilderInterface<ContractRow>, op: WhereFilterOp) =>
    qb.where("title", op, "anything");

/** Two conditions on one column: the shape the Mongo compiler used to drop. */
export const fluentRange = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("age", ">=", 18).where("age", "<", 65);

/** The object form must accept exactly what the fluent form accepts. */
export const paramsArrayContains: FindParams<ContractRow> = {
    where: { tags: ["array-contains", "featured"] }
};

/** …and the array-of-tuples form the builder produces from two `.where()` calls. */
export const paramsRange: FindParams<ContractRow> = {
    where: { age: [[">=", 18], ["<", 65]] }
};

// ── or()/and()/not()/cond() check against the row they are used on ─────────

/**
 * `cond` cannot know the row on its own; the place the group is used can.
 * `logical` and `.where(group)` check every condition in the tree against `M`,
 * as the object-form `where` does, so a typo'd column is a compile error, not
 * the server's 400.
 */
export const logicalOk: FindParams<ContractRow> = {
    logical: or(
        cond("status", "==", "published"),
        and(cond("age", ">=", 18), cond("tags", "array-contains", "featured")),
        not(cond("deleted_at", "is-null", null)),
        cond("author.name", "==", "bob")
    )
};

export const logicalTypo: FindParams<ContractRow> = {
    // @ts-expect-error - "titel" is not a column of ContractRow
    logical: or(cond("titel", "==", "x"))
};

export const logicalWrongValue: FindParams<ContractRow> = {
    // @ts-expect-error - `age` is a number
    logical: and(cond("age", "==", "many"))
};

export const logicalEnumTypo: FindParams<ContractRow> = {
    // @ts-expect-error - "publshed" is not a status
    logical: not(cond("status", "==", "publshed"))
};

export const logicalArrayContainsList: FindParams<ContractRow> = {
    // @ts-expect-error - `array-contains` takes one element, not a list
    logical: or(cond("tags", "array-contains", ["a"]))
};

export const fluentLogicalTypo = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - "titel" is not a column of ContractRow
    qb.where(or(cond("titel", "==", 1)));

export const fluentLogicalOk = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where(or(cond("status", "==", "draft"), cond("age", "<", 10)));

/** A group built at runtime keeps working where the row is untyped. */
export const untypedLogical = (qb: SDKQueryBuilderInterface, group: LogicalCondition) => {
    const built = and();
    built.conditions.push(cond("anything", "==", 1), group);
    return qb.where(built).where(group);
};

// ── what a query computes is readable off the row ──────────────────────────

/**
 * Sorting by relevance and then being unable to read it was the other half of
 * the same bug — the e2e cast around it, which should have been the tell.
 */
export const readComputed = (result: FindResult<ContractRow>) => {
    const row = result.data[0];
    const score: number | undefined = row._score;
    const distance: number | undefined = row._distance;
    const title: string = row.title;
    return { score, distance, title };
};

/** Widening the row must not have turned it into `any`. */
export const readUnknown = (result: FindResult<ContractRow>) =>
    // @ts-expect-error - `nope` is neither a column nor computed
    result.data[0].nope;

/**
 * A result row must stay assignable to `Record<string, unknown>`.
 *
 * Widening the row to `M & QueryComputedFields` broke this in seven places in
 * one downstream app, because `QueryComputedFields` was first written as an
 * `interface`: TypeScript grants an implicit index signature to a type alias
 * and withholds it from an interface, so the intersection stopped overlapping
 * with `Record<string, unknown>` and every `as Record<string, unknown>` cast
 * became an error. Nothing in this repo casts a row that way, which is why
 * nothing here noticed.
 */
export const rowStaysIndexable = (result: FindResult<ContractRow>) =>
    result.data.map(row => row as Record<string, unknown>);

// ── the builder accepts what find(params) accepts ──────────────────────────

/**
 * Four calls that `find(params)` took and the fluent builder refused.
 *
 * The two forms are one API with two spellings, and a caller who reaches for
 * the chainable one should not discover it is a subset. Each of these is
 * documented, works over HTTP, and was a compile error on a generated SDK —
 * which is to say: on every project that took the trouble to be typed.
 */

/** 1. A relation path. `find({ where: { "author.name": … } })` always compiled. */
export const fluentRelationPath = (qb: SDKQueryBuilderInterface<PostRow>) =>
    qb.where("author.name", "==", "bob");

/** 2. A JSON path into a `jsonb` column — `?metadata->>tier=eq.gold` on the wire. */
export const fluentJsonPath = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("metadata->>tier", "==", "gold");

/** 3. An aggregate over a to-many relation, which `FindParams.orderBy` takes. */
export const fluentRelationAggregateSort = (qb: SDKQueryBuilderInterface<PostRow>) =>
    qb.orderBy({ relation: "tags", agg: "count" }, "desc");

/** 4. Paging past the `limit` ceiling, which the client can do and the builder could not. */
export const fluentIterate = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("age", ">=", 18).iterate({ cursor: "id" });

export const fluentFindAll = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    qb.where("age", ">=", 18).findAll({ maxRows: 50_000 });

/**
 * The loosening is bounded. A path overload keyed on "anything that is not a
 * column" would have caught a mistyped column too and typed its value as
 * `unknown` — turning every one of the assertions above into a silent pass.
 * These are the same refusals as before.
 */
export const fluentPathTypo = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - "titel" has no dot and no `->>`: still just a typo
    qb.where("titel", "==", "x");

export const fluentPathDoesNotLoosenValues = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - a real column keeps its value type; `tags` is not one of its own elements
    qb.where("tags", "array-contains", ["featured"]);

export const fluentAggregateSortTypo = (qb: SDKQueryBuilderInterface<PostRow>) =>
    // @ts-expect-error - `agg` is a closed set; "median" is not one of them
    qb.orderBy({ relation: "tags", agg: "median" }, "desc");

/** And the object form still takes all four, unchanged. */
export const paramsRelationPath: FindParams<PostRow> = {
    where: { "author.name": ["==", "bob"] }
};

export const paramsJsonPath: FindParams<ContractRow> = {
    where: { "metadata->>tier": ["==", "gold"] }
};

export const paramsRelationAggregateSort: FindParams<PostRow> = {
    orderBy: [[{ relation: "tags", agg: "count" }, "desc"]]
};

// ── the object form types its values as the fluent form does ───────────────

/**
 * `FilterValues` typed the key and left the value `unknown`, so the shape the
 * fluent form was fixed to refuse compiled in `find({ where })` — the form
 * `listen`, `observe`, `count` and `iterate` all take.
 */
export const paramsArrayContainsWholeArray: FindParams<ContractRow> = {
    // @ts-expect-error - `array-contains` takes one element; the whole array builds `@> ARRAY[$1]` and matches nothing
    where: { tags: ["array-contains", ["featured"]] }
};

export const paramsWrongValueType: FindParams<ContractRow> = {
    // @ts-expect-error - `age` is a number
    where: { age: ["==", "many"] }
};

/** A path that is not a column has nothing to check against, and stays open. */
export const paramsRelationPathTyped: FindParams<ContractRow> = {
    where: { "author.name": ["==", "Ada"] }
};

/** An untyped row keeps the object form exactly as permissive as it was. */
export const paramsUntyped: FindParams = {
    where: { anything: ["array-contains", ["whatever"]] }
};

// ── a name the server would refuse is refused here ─────────────────────────

/** `fields` is a projection of columns; a typo was `UNKNOWN_FIELD` at runtime. */
export const fieldsColumn = (qb: SDKQueryBuilderInterface<ContractRow>) => qb.fields("title", "age");
export const fieldsTypo = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - not a column
    qb.fields("titel");

/** `vectorSearch` names a column. */
export const vectorTypo = (qb: SDKQueryBuilderInterface<ContractRow>) =>
    // @ts-expect-error - not a column
    qb.vectorSearch("embeding", [0.1]);

/** `sum` and `avg` add numbers up; `min`/`max` order anything. */
export const aggregateSum: AggregateParams<ContractRow> = { select: [{ fn: "sum", field: "age" }, { fn: "max", field: "title" }] };
export const aggregateSumText: AggregateParams<ContractRow> = {
    // @ts-expect-error - `title` is text: the server answers 400
    select: [{ fn: "sum", field: "title" }]
};

/** A field operation fits its column: `$inc` a number, `$push` an array. */
export const updateOps: UpdateValues<Partial<ContractRow>> = { age: { $inc: 1 }, tags: { $push: "x" } };
export const updateIncText: UpdateValues<Partial<ContractRow>> = {
    // @ts-expect-error - `$inc` on a text column is a 400
    title: { $inc: 1 }
};
/** An untyped row keeps every operation on every key. */
export const updateUntyped: UpdateValues<Partial<Record<string, unknown>>> = { anything: { $inc: 1 } };

/**
 * A typed client is still a client: a helper written against the wide
 * `SDKCollectionClient` (an export, a paginator, a seeder) takes
 * `rebase.data.posts`. The column checks above must narrow what a typed
 * client's methods accept without making the typed client a different kind
 * of thing — `NumericKeyOf` as a conditional over `keyof M` made tsc measure
 * `AggregateParams` invariant, and this line stopped compiling.
 */
export const typedClientWidens = (posts: SDKCollectionClient<ContractRow>): SDKCollectionClient => posts;
