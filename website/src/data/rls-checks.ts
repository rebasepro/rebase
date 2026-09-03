/**
 * The fifteen checks `@rebasepro/rls-check` runs.
 *
 * ── Copied from the source, not written for the page ─────────────────────────
 * Every `id`, `title` and `description` below is lifted verbatim from
 * `packages/rls-check/src/checks/*.ts`, in the order `checks/index.ts` declares
 * them — which is severity order, because that file is read by people deciding
 * what to look at first.
 *
 * Keeping the wording identical is the whole point. The ids are a public API:
 * they appear in `--skip`, in CI baselines, in the tool's own output, and in the
 * `Docs` link it prints beside every finding. A landing page that paraphrased
 * them would be a second, drifting description of a contract that already
 * exists, and the first person to notice would be someone comparing a finding
 * on their terminal against this page.
 *
 * `severity` is the worst level each check can emit. A few grade themselves down
 * depending on what they find — `policy-always-true` is critical on an open
 * policy and medium behind a gate — so read it as a ceiling, which is also how
 * someone scanning this page should read it.
 */

export interface RlsCheck {
    id: string;
    title: string;
    description: string;
    severity: "critical" | "high" | "medium";
}

export const RLS_CHECKS: RlsCheck[] = [
    {
        id: "rls-disabled",
        title: "Table exposed without row-level security",
        description:
            "A table with RLS disabled that also grants SELECT/INSERT/UPDATE/DELETE to a role an "
            + "unauthenticated or untrusted caller can reach.",
        severity: "critical"
    },
    {
        id: "policy-always-true",
        title: "Policy grants unconditional access",
        description: "A permissive policy whose USING or WITH CHECK expression is always true.",
        severity: "critical"
    },
    {
        id: "policy-anonymous-tautology",
        title: "Policy only checks that a caller id exists",
        description:
            "A policy whose expression is `auth.uid() IS NOT NULL`-shaped: it separates signed-in from "
            + "signed-out callers but scopes no rows.",
        severity: "critical"
    },
    {
        id: "policy-authenticated-tautology",
        title: "Policy admits every signed-in caller to every row",
        description:
            "A policy whose expression is only \"the caller is signed in and not anonymous\": it excludes "
            + "signed-out callers correctly and scopes no rows between accounts.",
        severity: "high"
    },
    {
        id: "view-bypasses-rls",
        title: "View reads past its base table's RLS",
        description:
            "A view granted to an untrusted role that selects from an RLS-protected table and runs with "
            + "its owner's privileges instead of the caller's.",
        severity: "critical"
    },
    {
        id: "matview-bypasses-rls",
        title: "Materialized view exposes RLS-protected data",
        description:
            "A materialized view granted to an untrusted role whose defining query reads a table with "
            + "row-level security enabled.",
        severity: "critical"
    },
    {
        id: "anonymous-write-allowed",
        title: "Unauthenticated callers can write",
        description:
            "A permissive INSERT/UPDATE/DELETE policy reachable without authentication whose check "
            + "expression accepts any row, backed by a matching grant.",
        severity: "critical"
    },
    {
        id: "unqualified-column-in-subquery",
        title: "Unqualified column inside a policy subquery",
        description:
            "A bare column name in an EXISTS/IN subquery that exists on both the inner relation and the "
            + "policy's own table, so Postgres binds it to the inner one.",
        severity: "high"
    },
    {
        id: "junction-table-unprotected",
        title: "Many-to-many join table without RLS",
        description:
            "A table that is essentially just two foreign keys, both pointing at RLS-protected tables, "
            + "that has no row-level security of its own.",
        severity: "high"
    },
    {
        id: "rls-enabled-not-forced",
        title: "RLS enabled but not forced for the table owner",
        description: "A table with RLS enabled where the owning role is exempt from its own policies.",
        severity: "medium"
    },
    {
        id: "rls-enabled-no-policies",
        title: "RLS enabled with no policies (denies everything)",
        description: "A table with row-level security enabled but not a single policy defined.",
        severity: "medium"
    },
    {
        id: "policy-role-unreachable",
        title: "Policies target roles nothing connects as",
        description:
            "Every policy on a table names roles that do not exist, cannot log in, and that no login role "
            + "inherits — so no policy ever applies and the table reads as empty.",
        severity: "medium"
    },
    {
        id: "grant-to-public",
        title: "Table privileges granted to PUBLIC",
        description: "A SELECT/INSERT/UPDATE/DELETE privilege granted to PUBLIC on a table.",
        severity: "medium"
    },
    {
        id: "security-definer-mutable-search-path",
        title: "SECURITY DEFINER routine with a mutable search_path",
        description:
            "A SECURITY DEFINER function or procedure that does not pin search_path, so the caller "
            + "controls how its identifiers resolve.",
        severity: "medium"
    },
    {
        id: "current-setting-throws",
        title: "Policy calls current_setting() without missing_ok",
        description:
            "A policy expression calling current_setting('x') with one argument, which raises rather than "
            + "returning NULL when the setting is unset.",
        severity: "medium"
    }
];

export const SEVERITY_LABEL: Record<RlsCheck["severity"], string> = {
    critical: "Critical",
    high: "High",
    medium: "Medium"
};
