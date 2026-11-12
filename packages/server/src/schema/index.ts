/**
 * `@rebasepro/server/schema` — what a `backend/schema/*.ts` file imports.
 *
 * The table builders, the policy expression builder and the authoring types,
 * re-exported from `@rebasepro/types`, and nothing else: importing this entry
 * evaluates no server module. A schema file must load in `rebase db generate`
 * without booting a server, and a frontend must be able to
 * `import type { posts } from "../backend/schema"` with no server runtime in
 * its bundle. `test/schema-subpath-graph.test.ts` holds that line.
 *
 * ```ts
 * import { defineTable, col, rel, policy } from "@rebasepro/server/schema";
 * ```
 *
 * @module
 */
export {
    defineTable,
    defineAuthTable,
    defineView,
    col,
    rel,
    json,
    policy,
    isTableDef,
    isAuthTableDef,
    isViewDef
} from "@rebasepro/types";

export type {
    // Tables and views as authored.
    TableDef,
    TableConfig,
    AuthTableConfig,
    AuthTableOptions,
    ViewDef,
    ViewConfig,
    AnyTableDef,
    AnyViewDef,
    ColumnsShape,
    RelationsShape,
    RlsPosture,
    DefaultRls,
    TableIndex,
    TableIndexKey,
    TableIndexPredicate,
    TableTenant,
    // Hooks.
    TableHooks,
    TableHookProps,
    TableBeforeQueryProps,
    TableAfterReadProps,
    TableBeforeSaveProps,
    TableAfterSaveProps,
    TableAfterSaveErrorProps,
    TableDeleteProps,
    TableRow,
    ColumnTransform,
    ColumnBeforeSaveProps,
    ColumnAfterReadProps,
    // Row types.
    InferRow,
    InferInsert,
    InferUpdate,
    // What the backend compiles a table to, and serves.
    TableDescriptor,
    ColumnDescriptor,
    RelationDescriptor,
    RlsDescriptor,
    // Security rules and the policy expressions they are written in.
    SecurityRule,
    SecurityOperation,
    PolicyExpression,
    PolicyCondition,
    PolicyShorthand,
    PolicyOperand
} from "@rebasepro/types";
