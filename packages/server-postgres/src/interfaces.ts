/**
 * Database Abstraction Interfaces
 *
 * These interfaces define the contracts that any database backend must implement
 * to be used with Rebase. This package is their Postgres implementation.
 */

import {
    Entity,
    FilterValues,
    WhereFilterOp,
    DatabaseConnection,
    QueryFilter,
    FetchCollectionOptions,
    SearchOptions,
    CountOptions,
    ConditionBuilder,
    ConditionBuilderStatic,
    DataRepository,
    CollectionSubscriptionConfig,
    SingleSubscriptionConfig,
    RealtimeProvider,
    TableRegistryInterface,
    BackendConfig,
    BackendInstance,
    BackendFactory
} from "@rebasepro/types";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Assume } from "drizzle-orm";
import { PgDatabase, PgTransaction, type PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * What every Postgres drizzle session resolves a statement to: its rows.
 * `rowCount` is node-postgres's; PGlite leaves it out.
 */
export interface PgRowsResult<TRow> {
    rows: TRow[];
    rowCount?: number | null;
}

/** The result kind of {@link PgSqlDatabase}: {@link PgRowsResult} of the row a statement selects. */
export interface PgRowsResultHKT extends PgQueryResultHKT {
    type: PgRowsResult<Assume<this["row"], Record<string, unknown>>>;
}

/**
 * A Postgres drizzle database, whichever session carries it — node-postgres
 * in production, PGlite in the in-process tests — read through what they
 * share. Statements resolve to their rows.
 */
export type PgSqlDatabase<TSchema extends Record<string, unknown> = Record<string, unknown>> =
    PgDatabase<PgRowsResultHKT, TSchema>;

/**
 * Type representing either a direct database connection or a transaction.
 * Used to allow services to operate within a transaction context.
 * Note: `any` is intentional here — it represents a Drizzle client with
 * a dynamic schema, enabling `db.query[tableName]` access without casts.
 * A transaction's result kind is `any` too, so admitting any Postgres
 * drizzle database — whichever session carries it: node-postgres, PGlite, a
 * proxy — costs no precision.
 */

export type DrizzleClient = NodePgDatabase<any> | PgTransaction<any, any, any> | PgDatabase<any, any, any>;

export type {
    DatabaseConnection,
    QueryFilter,
    FetchCollectionOptions,
    SearchOptions,
    CountOptions,
    ConditionBuilder,
    ConditionBuilderStatic,
    DataRepository,
    CollectionSubscriptionConfig,
    SingleSubscriptionConfig,
    RealtimeProvider,
    TableRegistryInterface,
    BackendConfig,
    BackendInstance,
    BackendFactory
};
