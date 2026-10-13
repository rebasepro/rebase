import type { Check, DbRelation, DbSnapshot, DbView, Finding } from "../types";

import { exposedGrantees, finding, listAnd, qi, qrel, relationAt, revokesReaching, roleNamed, rolesUsableBy } from "./util";

const ID = "view-bypasses-rls";

/** Base relations of `view` that have RLS turned on. */
export function protectedBaseTables(snapshot: DbSnapshot, view: DbView): DbRelation[] {
    return view.dependsOn
        .map((d) => relationAt(snapshot, d.schema, d.table))
        .filter((r): r is DbRelation => Boolean(r?.rlsEnabled));
}

/**
 * Whether `owner` reads `base` past its policies: as a superuser, with
 * BYPASSRLS, or as the table's owner (a member of the owning role counts, as
 * Postgres counts it) while FORCE ROW LEVEL SECURITY is off. A role the
 * catalog read did not return is assumed to — the scan must not go quiet on
 * what it could not see.
 */
export function ownerReadsPast(snapshot: DbSnapshot, owner: string, base: DbRelation): boolean {
    const role = roleNamed(snapshot, owner);
    if (!role) return true;
    if (role.superuser || role.bypassRls) return true;
    return !base.rlsForced && rolesUsableBy(snapshot, owner).has(base.owner.toLowerCase());
}

/**
 * A view granted to an untrusted role that reads an RLS-protected table without
 * `security_invoker`.
 *
 * A view without that option executes its query as the view's *owner*, and the
 * owner is normally exempt from the base table's policies — so the view hands
 * back exactly the rows the policies were written to withhold. This is the most
 * common way a carefully locked-down schema leaks: the tables are audited, the
 * views over them are not.
 *
 * Before PG 15 the option does not exist, which means every view behaves this
 * way. That is worth saying, but it is not evidence that *this* view is a
 * mistake, so those findings are marked heuristic.
 *
 * The owner is *normally* exempt, not always. A view owned by a role the base
 * tables' policies do apply to returns what those policies give that role —
 * to every caller alike, which may be nothing at all. Still reported, because
 * the rows do not depend on who asks, but heuristic: whether it hands out more
 * than a caller should see depends on the owner's policies.
 */
export const viewBypassesRls: Check = {
    id: ID,
    title: "View reads past its base table's RLS",
    description:
        "A view granted to an untrusted role that selects from an RLS-protected table and runs " +
        "with its owner's privileges instead of the caller's.",

    run(snapshot: DbSnapshot): Finding[] {
        const findings: Finding[] = [];

        for (const view of snapshot.views) {
            if (!snapshot.schemas.includes(view.schema)) continue;

            // `views` carries materialized views too, for their dependencies;
            // they cannot take security_invoker and have their own check.
            const rel = relationAt(snapshot, view.schema, view.name);
            if (rel && rel.kind !== "view") continue;

            if (view.securityInvoker === true) continue;

            const baseTables = protectedBaseTables(snapshot, view);
            if (baseTables.length === 0) continue;
            const bases = baseTables.map((r) => `${r.schema}.${r.name}`);

            const exposed = exposedGrantees(snapshot, view.schema, view.name, ["SELECT"]);
            if (exposed.length === 0) continue;

            const roles = exposed.map((e) => e.role);
            const legacy = view.securityInvoker === null;
            const ownerConstrained = !baseTables.some((base) => ownerReadsPast(snapshot, view.owner, base));
            const constrainedNote =
                ` ${view.owner} is itself subject to the policies on ${listAnd(bases)} — it is not a ` +
                `superuser, holds no BYPASSRLS and ${bases.length > 1 ? "owns none of them" : "does not own it"} ` +
                `without FORCE ROW LEVEL SECURITY — so the view returns the rows those policies give ` +
                `${view.owner}, to every caller alike. That may be fewer rows than a caller should see, or ` +
                `more; it is never the caller's own view of the table.`;

            findings.push(
                finding({
                    id: ID,
                    severity: "critical",
                    confidence: legacy || ownerConstrained ? "heuristic" : "certain",
                    title:
                        `View ${view.schema}.${view.name} reads ${listAnd(bases)} without ` +
                        `security_invoker and is readable by ${listAnd(roles)}`,
                    target: { schema: view.schema, view: view.name, table: view.name },
                    detail: legacy
                        ? `This server is PostgreSQL ${snapshot.serverVersion}, where the ` +
                          `\`security_invoker\` view option does not exist — every view runs with its ` +
                          `owner's privileges. This view is owned by ${view.owner} and selects from ` +
                          `${listAnd(bases)}, which ${bases.length > 1 ? "have" : "has"} row-level ` +
                          `security enabled.` +
                          (ownerConstrained
                              ? constrainedNote
                              : ` ${view.owner} reads past those policies, so the view returns rows the ` +
                                `policies would have filtered out.`)
                        : `The view is owned by ${view.owner} and \`security_invoker\` is not set, so its ` +
                          `query executes with ${view.owner}'s privileges rather than the caller's. ` +
                          `Row-level security on ${listAnd(bases)} is evaluated for ${view.owner}, not ` +
                          `for the role that selected from the view.` +
                          (ownerConstrained ? constrainedNote : ""),
                    impact:
                        `If this view is reachable over an API as ${listAnd(roles)}, a caller reads rows ` +
                        `from ${listAnd(bases)} that the policies on ${bases.length > 1 ? "those tables" : "that table"} ` +
                        `were written to withhold — the view is an unfiltered path around them.`,
                    fix: legacy
                        ? `-- \`security_invoker\` requires PostgreSQL 15 or newer. On this server, either:\n` +
                          `--   1. revoke access and let callers query the base table directly:\n` +
                          `${revokesReaching(snapshot, view.schema, view.name, roles, ["SELECT"]).join("\n")}\n` +
                          `--   2. or set FORCE ROW LEVEL SECURITY on the base tables and add policies\n` +
                          `--      that apply to ${qi(view.owner)}, so the view's own execution is filtered.`
                        : `ALTER VIEW ${qrel(view.schema, view.name)} SET (security_invoker = true);\n` +
                          `-- Callers then need their own SELECT privilege on ` +
                          `${listAnd(baseTables.map((r) => qrel(r.schema, r.name)))}, and the\n` +
                          `-- policies there apply to them.`
                })
            );
        }

        return findings;
    }
};
