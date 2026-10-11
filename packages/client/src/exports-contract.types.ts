/**
 * Compile-time assertion that a consumer can name, from `@rebasepro/client`
 * alone, the types its own calls are written in.
 *
 * A plain module under `src`, imported by nothing, for the reason
 * `query-contract.types.ts` gives: `pnpm typecheck` reads `src`, and a type
 * assertion in a jest test is checked by nothing. A browser app installs this
 * package only, so an argument type missing from the barrel is one it has to
 * spell out by hand or reach into a package it never installed.
 */
import type {
    AggregateMeta,
    AggregateParams,
    AggregateResult,
    AggregateRow,
    AggregateSelect,
    FieldPath,
    FilterCondition,
    FilterValues,
    IncludeOptions,
    IncludeSpec,
    InsertOf,
    LogicalCondition,
    OrderBySpec,
    QueryComputedFields,
    RowOf,
    StorageSource,
    UpdateOf,
    WhereConditionFor,
    WhereFilterOp,
    WhereFor,
    WhereValueFor,
    WriteOptions
} from "./index";

export type ConsumerCanName = [
    AggregateMeta, AggregateParams, AggregateResult, AggregateRow, AggregateSelect,
    FieldPath, FilterCondition, FilterValues<string>, IncludeOptions, IncludeSpec,
    InsertOf<Record<string, unknown>>, LogicalCondition, OrderBySpec, QueryComputedFields,
    RowOf<Record<string, unknown>>, StorageSource, UpdateOf<Record<string, unknown>>,
    WhereConditionFor<string>, WhereFilterOp, WhereFor<Record<string, unknown>>,
    WhereValueFor<"==", string>, WriteOptions
];
