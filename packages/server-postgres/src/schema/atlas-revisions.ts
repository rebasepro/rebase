/**
 * Atlas's revisions table on the managed development database, made by Rebase.
 *
 * `rebase db migrate` passes `--revisions-schema rebase`, so Atlas keeps its
 * history in `rebase.atlas_schema_revisions`. Atlas finds that table by
 * qualified name, but creates it through a second connection whose startup
 * message sets `search_path=rebase`, with an unqualified `CREATE TABLE`. The
 * managed database is one PGlite session that every connection shares, so a
 * connection's own `search_path` is never applied: the table landed in
 * `public`, the read that followed failed on `relation
 * "rebase.atlas_schema_revisions" does not exist (42P01)`, and every later run
 * failed on `relation "atlas_schema_revisions" already exists (42P07)`, with or
 * without `--baseline`.
 *
 * So on that database the table is created here first, qualified, and Atlas
 * finds it where it looks. The definition is Atlas's own for the pinned
 * `@ariga/atlas`, read off a table Atlas created on PostgreSQL 18. Should a
 * later Atlas want a different one, it alters the table through the same
 * unqualified path and fails loudly there, and the managed `db migrate`
 * integration test fails with it.
 *
 * Not used on any other database: there the connection's `search_path` holds,
 * and Atlas creates and maintains its table itself.
 */
import { withAppClient } from "../cli-helpers";

/** Atlas's revisions table, in the schema `--revisions-schema rebase` names. */
export const ATLAS_REVISIONS_TABLE_SQL = `CREATE SCHEMA IF NOT EXISTS "rebase";
CREATE TABLE IF NOT EXISTS "rebase"."atlas_schema_revisions" (
    "version" character varying NOT NULL,
    "description" character varying NOT NULL,
    "type" bigint NOT NULL DEFAULT 2,
    "applied" bigint NOT NULL DEFAULT 0,
    "total" bigint NOT NULL DEFAULT 0,
    "executed_at" timestamp with time zone NOT NULL,
    "execution_time" bigint NOT NULL,
    "error" text NULL,
    "error_stmt" text NULL,
    "hash" character varying NOT NULL,
    "partial_hashes" jsonb NULL,
    "operator_version" character varying NOT NULL,
    PRIMARY KEY ("version")
);`;

/** Create `rebase.atlas_schema_revisions` if it is not there yet. */
export async function ensureAtlasRevisionsTable(databaseUrl: string): Promise<void> {
    await withAppClient(databaseUrl, client => client.query(ATLAS_REVISIONS_TABLE_SQL));
}
