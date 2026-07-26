/**
 * Builders for a valid {@link DbSnapshot}.
 *
 * Checks are pure functions of a snapshot, so every interesting case can be
 * written by hand — no Docker, no fixtures loaded from SQL. The point of the
 * defaults here is that a test states only the thing it is about: a test for
 * "RLS off but granted to anon" should not have to invent a server version, a
 * role list or a column set.
 *
 * The defaults describe a small, plausible, PostgREST-shaped database: a
 * NOLOGIN `anon` and `authenticated`, a LOGIN `authenticator` that is a member
 * of both, and a LOGIN `postgres` owner. That shape matters — several checks
 * key off role reachability, and a role graph that is too simple would let a
 * broken transitive lookup pass.
 */
import type {
    DbColumn,
    DbForeignKey,
    DbGrant,
    DbPolicy,
    DbRelation,
    DbRole,
    DbRoutine,
    DbSnapshot,
    DbView
} from "../../src/types";

type ColumnSpec = string | (Partial<DbColumn> & { name: string });

export function column(spec: ColumnSpec): DbColumn {
    const base = typeof spec === "string" ? { name: spec } : spec;
    return {
        name: base.name,
        type: base.type ?? (base.name === "id" ? "uuid" : "text"),
        notNull: base.notNull ?? false,
        isPrimaryKey: base.isPrimaryKey ?? base.name === "id"
    };
}

export interface TableSpec extends Partial<Omit<DbRelation, "columns" | "schema" | "name">> {
    columns?: ColumnSpec[];
}

export function table(schema: string, name: string, spec: TableSpec = {}): DbRelation {
    return {
        schema,
        name,
        kind: spec.kind ?? "table",
        owner: spec.owner ?? "postgres",
        rlsEnabled: spec.rlsEnabled ?? false,
        rlsForced: spec.rlsForced ?? false,
        columns: (spec.columns ?? ["id"]).map(column),
        estimatedRows: spec.estimatedRows ?? -1
    };
}

export const viewRelation = (schema: string, name: string, spec: TableSpec = {}): DbRelation =>
    table(schema, name, { ...spec, kind: spec.kind ?? "view" });

export const matviewRelation = (schema: string, name: string, spec: TableSpec = {}): DbRelation =>
    table(schema, name, { ...spec, kind: spec.kind ?? "materialized_view" });

export function view(
    schema: string,
    name: string,
    spec: Partial<Omit<DbView, "schema" | "name">> = {}
): DbView {
    return {
        schema,
        name,
        owner: spec.owner ?? "postgres",
        // `null` is meaningful here — it is what a pre-PG15 server reports — so
        // it must survive rather than being coalesced into `false`.
        securityInvoker: "securityInvoker" in spec ? (spec.securityInvoker ?? null) : false,
        dependsOn: spec.dependsOn ?? []
    };
}

export function policy(
    schema: string,
    tableName: string,
    name: string,
    spec: Partial<Omit<DbPolicy, "schema" | "table" | "name">> = {}
): DbPolicy {
    return {
        schema,
        table: tableName,
        name,
        permissive: spec.permissive ?? true,
        roles: spec.roles ?? ["public"],
        command: spec.command ?? "SELECT",
        using: spec.using ?? null,
        withCheck: spec.withCheck ?? null
    };
}

export function role(name: string, spec: Partial<Omit<DbRole, "name">> = {}): DbRole {
    return {
        name,
        canLogin: spec.canLogin ?? false,
        superuser: spec.superuser ?? false,
        bypassRls: spec.bypassRls ?? false,
        memberOf: spec.memberOf ?? []
    };
}

export function grant(
    schema: string,
    tableName: string,
    grantee: string,
    privileges: DbGrant["privileges"] = ["SELECT"]
): DbGrant {
    return { schema, table: tableName, grantee, privileges };
}

export function foreignKey(
    schema: string,
    tableName: string,
    columns: string[],
    refSchema: string,
    refTable: string,
    refColumns: string[] = ["id"]
): DbForeignKey {
    return { schema, table: tableName, columns, refSchema, refTable, refColumns };
}

export function routine(
    schema: string,
    name: string,
    spec: Partial<Omit<DbRoutine, "schema" | "name">> = {}
): DbRoutine {
    return {
        schema,
        name,
        owner: spec.owner ?? "postgres",
        securityDefiner: spec.securityDefiner ?? false,
        mutableSearchPath: spec.mutableSearchPath ?? true
    };
}

export const DEFAULT_ROLES: DbRole[] = [
    role("postgres", { canLogin: true, superuser: true }),
    role("authenticator", { canLogin: true, memberOf: ["anon", "authenticated"] }),
    role("anon"),
    role("authenticated"),
    role("service_role")
];

export function snapshot(overrides: Partial<DbSnapshot> = {}): DbSnapshot {
    return {
        serverVersionNum: 160004,
        serverVersion: "16.4",
        currentRole: "postgres",
        scannerIsPrivileged: true,
        schemas: ["public"],
        exposedRoles: ["PUBLIC", "anon", "authenticated"],
        platform: "unknown",
        relations: [],
        policies: [],
        roles: DEFAULT_ROLES,
        grants: [],
        views: [],
        foreignKeys: [],
        routines: [],
        ...overrides
    };
}
