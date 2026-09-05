/**
 * The contract between the three layers of `rls-check`:
 *
 *   introspect.ts  — reads the catalogs into a {@link DbSnapshot}. Talks to Postgres.
 *   checks/*.ts    — pure functions, snapshot in, {@link Finding}s out. No I/O.
 *   report.ts      — Findings to text or JSON. No knowledge of Postgres.
 *
 * Checks being pure is the point: every one of them is unit-testable against a
 * hand-written snapshot, so the test suite does not need a live database to
 * cover the interesting cases (it has a Docker-backed suite too, for the
 * introspection layer, which is the only part that can lie).
 */

/** Ordered least → most severe; the CLI's `--fail-on` compares by index. */
export const SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;

export type Severity = (typeof SEVERITIES)[number];

/** What a finding points at. `table` is absent for database-wide findings. */
export interface FindingTarget {
    schema: string;
    table?: string;
    /** Policy name, for policy-level findings. */
    policy?: string;
    view?: string;
    routine?: string;
    column?: string;
}

export interface Finding {
    /**
     * Stable, kebab-case check id — `rls-disabled`, `permissive-tautology`.
     * Stable because people put it in `--skip` lists and CI baselines; treat a
     * rename as a breaking change.
     */
    id: string;
    severity: Severity;
    /** One line, specific: names the object and what is wrong with it. */
    title: string;
    target: FindingTarget;
    /**
     * Why this is wrong, in concrete terms. Not "RLS is recommended" — say what
     * the database will actually do when a request arrives.
     */
    detail: string;
    /**
     * What an unauthenticated or wrong-tenant caller gets out of it. This is the
     * line people screenshot, so it must be true and not inflated: if reachability
     * depends on the API layer, say "if this table is exposed over an API".
     */
    impact: string;
    /** Copy-pasteable SQL, or a precise instruction when SQL cannot express it. */
    fix?: string;
    /** Anchor on https://rebase.pro/docs/rls-check#<id>, filled in by the check. */
    docs?: string;
    /**
     * How sure the check is. Heuristic checks (junction inference, unqualified
     * column detection) MUST set `"heuristic"` — the report separates them, and
     * a false positive in the confident bucket is what makes a tool like this
     * get uninstalled.
     */
    confidence: "certain" | "heuristic";
}

// ---------------------------------------------------------------------------
// Snapshot — the read-only picture of the database the checks reason about.
// ---------------------------------------------------------------------------

/**
 * `pg_class.relkind`, spelled out.
 *
 * Named `RelationKind` until that collided with `RelationKind` in
 * `@rebasepro/types`, which is the cardinality of a *collection* relation
 * (`belongsTo` | `hasOne` | `hasMany` | `manyToMany` | `via`). Unrelated
 * meanings, and the shared word is "relation" in two different senses —
 * Postgres's (any table-like object) and the data model's (a link between
 * collections).
 */
export type PgRelationKind = "table" | "partitioned_table" | "view" | "materialized_view" | "foreign_table";

export interface DbRelation {
    schema: string;
    name: string;
    kind: PgRelationKind;
    owner: string;
    /** `pg_class.relrowsecurity`. Always false for views. */
    rlsEnabled: boolean;
    /** `pg_class.relforcerowsecurity` — without it the owner bypasses RLS. */
    rlsForced: boolean;
    columns: DbColumn[];
    /** Estimated live rows (`pg_class.reltuples`), -1 when never analyzed. */
    estimatedRows: number;
}

export interface DbColumn {
    name: string;
    type: string;
    notNull: boolean;
    isPrimaryKey: boolean;
}

export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export interface DbPolicy {
    schema: string;
    table: string;
    name: string;
    /** PERMISSIVE policies OR together; RESTRICTIVE ones AND. */
    permissive: boolean;
    /** Roles in the TO clause. `["public"]` means every role. */
    roles: string[];
    command: PolicyCommand;
    /** `pg_policies.qual` — the USING expression, as Postgres rewrote it. */
    using: string | null;
    /** `pg_policies.with_check`. */
    withCheck: string | null;
}

export interface DbRole {
    name: string;
    canLogin: boolean;
    superuser: boolean;
    /** BYPASSRLS — every policy is a no-op for this role. */
    bypassRls: boolean;
    /** Roles this one is a member of, transitively resolved. */
    memberOf: string[];
}

/** One privilege grant on a relation, from `information_schema.role_table_grants`. */
export interface DbGrant {
    schema: string;
    table: string;
    grantee: string;
    privileges: ("SELECT" | "INSERT" | "UPDATE" | "DELETE" | "TRUNCATE" | "REFERENCES" | "TRIGGER")[];
}

export interface DbView {
    schema: string;
    name: string;
    owner: string;
    /**
     * PG15+ `security_invoker=true`. When false, the view runs with the *owner's*
     * privileges, so it reads straight past the RLS on its base tables.
     * `null` on servers older than 15, where the option does not exist at all.
     */
    securityInvoker: boolean | null;
    /** Base relations the view reads, resolved through `pg_depend`. */
    dependsOn: { schema: string; table: string }[];
}

export interface DbForeignKey {
    schema: string;
    table: string;
    columns: string[];
    refSchema: string;
    refTable: string;
    refColumns: string[];
}

export interface DbRoutine {
    schema: string;
    name: string;
    owner: string;
    /** SECURITY DEFINER runs as the owner and can bypass RLS. */
    securityDefiner: boolean;
    /** True when `search_path` is NOT pinned in the routine's config. */
    mutableSearchPath: boolean;
}

export interface DbSnapshot {
    /** `server_version_num`, e.g. 160004. */
    serverVersionNum: number;
    serverVersion: string;
    /** The role the scan itself connected as. */
    currentRole: string;
    /** True when the scanning role cannot be constrained by RLS — see report caveat. */
    scannerIsPrivileged: boolean;
    /** Schemas actually scanned, after `--schema` and the system-schema filter. */
    schemas: string[];
    /**
     * Roles that are plausibly reachable by an untrusted caller: Supabase's
     * `anon` / `authenticated`, PostgREST's `web_anon`, Rebase's `rebase_user`,
     * plus `PUBLIC` — and anything named with `--role`. Checks use this to
     * decide whether an exposure is real, so a stack whose app role is not on
     * that list must name it or the checks have nothing to gate on.
     */
    exposedRoles: string[];
    /** Detected platform, which changes the wording of several findings. */
    platform: "supabase" | "neon" | "rebase" | "postgrest" | "unknown";
    relations: DbRelation[];
    policies: DbPolicy[];
    roles: DbRole[];
    grants: DbGrant[];
    views: DbView[];
    foreignKeys: DbForeignKey[];
    routines: DbRoutine[];
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export interface Check {
    id: string;
    /** Shown in `--list-checks`. */
    title: string;
    /** One sentence on what the check looks for. */
    description: string;
    run(snapshot: DbSnapshot): Finding[];
}

export interface ScanResult {
    /** ISO timestamp, stamped by the caller — checks stay pure. */
    scannedAt: string;
    /** Host and database only. NEVER the user, password or full URL. */
    database: { host: string; name: string };
    serverVersion: string;
    platform: DbSnapshot["platform"];
    scannerIsPrivileged: boolean;
    /**
     * The roles every check gated on. Reported because it is the single fact
     * that decides whether a clean run means anything: a check only calls a
     * table exposed when one of these can reach it, so a reader who does not
     * see their own app role here knows the run did not cover their API.
     */
    exposedRoles: string[];
    stats: {
        schemas: number;
        tables: number;
        policies: number;
        tablesWithoutRls: number;
        checksRun: number;
    };
    findings: Finding[];
    /**
     * What the scan could not read.
     *
     * `introspect` records every catalogue query that failed, and `introspect()`
     * threw the record away before `scan` saw it — `ScanResult` had no field for
     * it, and neither the report nor the exit code mentioned it. A single failed
     * grants read silently disables `rls-disabled`, both view checks and
     * `anonymous-write-allowed`, and the run then prints "✓ No unexpected RLS
     * findings" and exits 0.
     *
     * A scanner that cannot say "I could not look" is worse than no scanner: it
     * answers the question it was asked with the wrong word.
     */
    diagnostics: {
        /** Catalogue reads that failed, and why. Non-empty means degraded. */
        degraded: { what: string; error: string }[];
        /** TLS certificate verification was turned off to connect. */
        tlsVerificationDisabled: boolean;
        /** Schemas left out of the scan, and why. */
        excludedSchemas: { schema: string; reason: "system" | "platform" | "not-requested" }[];
        /**
         * Roles holding read or write privileges on scanned tables that the scan
         * neither recognises as exposed nor can explain as trusted. Non-empty
         * means the exposed-role set may be incomplete, and every check gates on
         * that set — so this is the difference between "clean" and "clean as far
         * as I could tell".
         */
        unrecognizedGrantees: string[];
        /**
         * The role the scan connected as, when RLS constrains it and it was
         * therefore treated as exposed. `null` or absent when the scan connected
         * as a superuser, an owner or a BYPASSRLS role — the case
         * `scannerIsPrivileged` already describes.
         */
        scanningAsExposedRole?: string | null;
    };
}
