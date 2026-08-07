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
import type { FindParams, FindResult, SDKQueryBuilderInterface } from "@rebasepro/types";

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
};

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
