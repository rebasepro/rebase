/**
 * Shared vocabulary for the checks.
 *
 * Everything here is about answering one question honestly: *can an untrusted
 * caller actually reach this object?* A finding that cannot answer it becomes
 * noise, and noise is what gets a tool like this uninstalled — so the helpers
 * below err towards "no" whenever the catalog is ambiguous.
 */
import type { DbGrant, DbPolicy, DbRelation, DbSnapshot, Finding, Severity } from "../types";

export const SEVERITY_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];

export const docsFor = (id: string): string => `https://rebase.pro/docs/rls-check#${id}`;

export type Privilege = DbGrant["privileges"][number];

/** The privileges that actually move data. TRUNCATE/REFERENCES/TRIGGER are not exposure. */
export const DML: Privilege[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];
export const WRITE_PRIVILEGES: Privilege[] = ["INSERT", "UPDATE", "DELETE"];

/** Roles a caller reaches without ever authenticating. */
export const ANONYMOUS_ROLES = ["public", "anon", "web_anon"];

export const isPublicRole = (role: string): boolean => role.toLowerCase() === "public";
export const sameRole = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Every role whose grants `role` actually receives: itself, PUBLIC, and the
 * transitive closure of its memberships.
 *
 * Skipping the closure is the specific way this class of tool produces false
 * *negatives* on the databases that were configured most carefully — a shop
 * that grants to `app_reader` and makes `anon` a member of it looks clean to a
 * checker that only compares grantee names.
 */
export function rolesUsableBy(snapshot: DbSnapshot, role: string): Set<string> {
    const out = new Set<string>(["public", role.toLowerCase()]);
    const def = snapshot.roles.find((r) => sameRole(r.name, role));
    for (const m of def?.memberOf ?? []) out.add(m.toLowerCase());
    return out;
}

/** Privileges `role` effectively holds on a relation, memberships included. */
export function effectivePrivileges(
    snapshot: DbSnapshot,
    schema: string,
    table: string,
    role: string
): Set<Privilege> {
    const via = rolesUsableBy(snapshot, role);
    const out = new Set<Privilege>();
    for (const g of snapshot.grants) {
        if (g.schema !== schema || g.table !== table) continue;
        if (!via.has(g.grantee.toLowerCase())) continue;
        for (const p of g.privileges) out.add(p);
    }
    return out;
}

/**
 * Which exposed roles hold at least one of `wanted` on this relation, and which.
 * Returns an empty array when nothing untrusted can touch it — the signal that
 * a finding would be noise.
 */
export function exposedGrantees(
    snapshot: DbSnapshot,
    schema: string,
    table: string,
    wanted: Privilege[] = DML
): { role: string; privileges: Privilege[] }[] {
    const out: { role: string; privileges: Privilege[] }[] = [];
    for (const role of snapshot.exposedRoles) {
        const held = effectivePrivileges(snapshot, schema, table, role);
        const hit = wanted.filter((p) => held.has(p));
        if (hit.length > 0) out.push({ role, privileges: hit });
    }
    return out;
}

/** Does this policy's TO list name a role an untrusted caller arrives as? */
export function policyTargetsExposedRole(snapshot: DbSnapshot, policy: DbPolicy): string[] {
    const hits: string[] = [];
    for (const target of policy.roles) {
        if (isPublicRole(target)) {
            hits.push("PUBLIC");
            continue;
        }
        // A policy TO `app_reader` applies to `anon` when anon inherits it.
        for (const exposed of snapshot.exposedRoles) {
            if (isPublicRole(exposed)) continue;
            if (rolesUsableBy(snapshot, exposed).has(target.toLowerCase())) {
                hits.push(exposed);
                break;
            }
        }
    }
    return [...new Set(hits)];
}

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const TABLE_KINDS: DbRelation["kind"][] = ["table", "partitioned_table"];

export const isTable = (r: DbRelation): boolean => TABLE_KINDS.includes(r.kind);

export function scannedTables(snapshot: DbSnapshot): DbRelation[] {
    return snapshot.relations.filter((r) => isTable(r) && snapshot.schemas.includes(r.schema));
}

export function relationAt(snapshot: DbSnapshot, schema: string, name: string): DbRelation | undefined {
    return snapshot.relations.find((r) => r.schema === schema && r.name === name);
}

export function policiesFor(snapshot: DbSnapshot, schema: string, table: string): DbPolicy[] {
    return snapshot.policies.filter((p) => p.schema === schema && p.table === table);
}

export const hasColumn = (r: DbRelation, name: string): boolean =>
    r.columns.some((c) => c.name.toLowerCase() === name.toLowerCase());

/** `≈ 12,000 rows` — only ever used to convey blast radius, never severity. */
export function rowsPhrase(rel: DbRelation | undefined): string {
    if (!rel || rel.estimatedRows < 0) return "";
    if (rel.estimatedRows === 0) return " (the planner currently estimates 0 rows)";
    return ` (≈${Math.round(rel.estimatedRows).toLocaleString("en-US")} rows)`;
}

// ---------------------------------------------------------------------------
// SQL rendering for the `fix` field
// ---------------------------------------------------------------------------

export const qi = (ident: string): string => `"${ident.replace(/"/g, '""')}"`;
export const qrel = (schema: string, name: string): string => `${qi(schema)}.${qi(name)}`;
/** PUBLIC is a keyword, not an identifier — quoting it changes what it means. */
export const qrole = (role: string): string => (isPublicRole(role) ? "PUBLIC" : qi(role));

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export function finding(f: Omit<Finding, "docs"> & { docs?: string }): Finding {
    return { ...f, docs: f.docs ?? docsFor(f.id) };
}

export const listAnd = (items: string[]): string =>
    items.length <= 1
        ? (items[0] ?? "")
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * How to spell "the id of the current caller" in a fix suggestion, for the
 * platform this database actually is.
 *
 * Every remediation in this tool prints example SQL, and example SQL that calls
 * a function the reader's database does not have is worse than no example — it
 * looks authoritative and fails on paste. Rebase's helpers live in `rebase`
 * (they were in `auth` before 1.0, which is Supabase's schema and the reason
 * they moved); Supabase and PostgREST stacks have `auth.uid()`.
 *
 * `unknown` falls back to the Supabase spelling: this scanner is pointed at
 * plenty of databases Rebase did not create, and that is the wider convention.
 */
export function callerIdCall(snapshot: DbSnapshot): string {
    return snapshot.platform === "rebase" ? "rebase.uid()" : "auth.uid()";
}
