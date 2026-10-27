export * from "./connection";
export * from "./interfaces";
export * from "./PostgresBackendDriver";
export * from "./databasePoolManager";
export * from "./schema/auth-schema";
export * from "./schema/generate-drizzle-schema-logic";
export * from "./schema/generate-drizzle-schema";
export * from "./utils/drizzle-conditions";
export * from "./services/realtimeService";
// The channel bus is a public extension point: a transport published as its own
// package implements `ChannelBus` (declared in @rebasepro/types and re-exported
// here) and is passed to `realtime.bus`. Without this export it would be one.
export * from "./services/channel-bus";
export * from "./websocket";
export * from "./collections/PostgresCollectionRegistry";
export * from "./services/BranchService";
export { diffDatabaseBranch, mergeDatabaseBranch, DEFAULT_BRANCH_DIFF_SAMPLE_LIMIT, DEFAULT_BRANCH_DIFF_MAX_ROWS } from "./branching/branch-diff";
export * from "./backup";
export * from "./PostgresBootstrapper";
export * from "./PostgresAdapter";
export * from "./open-rebase";
export { assertDbCommandLine } from "./db-command-line";

/**
 * Whether the migration files still build what the collections declare —
 * offline, without Atlas or a dev database. `rebase verify` runs it after every
 * collection edit and in CI.
 */
export { findUnmigratedSchema } from "./schema/migration-freshness";
export type { UnmigratedChange } from "./schema/migration-freshness";

/**
 * Atlas's version order and the version a migration file records, for a
 * caller that reads `rebase.atlas_schema_revisions` itself — `rebase verify
 * --live` counts a baselined database's earlier migrations as applied.
 */
export { compareMigrationVersions, migrationVersionOf } from "./schema/migrate-baseline";

/**
 * Whether a policy name is one Rebase generates from a collection's
 * `securityRules` — `rebase verify --live` reads such a public-read policy as
 * what the rule says rather than as a hand-written hole.
 */
export { isGeneratedPolicyName } from "./security/policy-drift";

/**
 * The app-role provisioning boot performs, for callers that restore a database
 * outside a boot.
 *
 * `rebase db pull` writes a database nobody has booted yet: `pg_dump
 * --no-privileges` strips every GRANT, so the copy arrives with its policies
 * and its RLS intact and no privileges at all, and the first read as
 * `rebase_user` fails with `permission denied`. It needs exactly what
 * `PostgresBootstrapper` and `rebase db push` already do, and needs it to be
 * the same code rather than a second description of the same grants.
 */
export { ensureAppRole, detectConnectionPosture, REBASE_USER_ROLE } from "./security/rls-enforcement";
