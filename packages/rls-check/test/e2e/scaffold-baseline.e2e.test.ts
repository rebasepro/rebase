/**
 * Integration: what `rls-check` says about a stock Rebase project on day one.
 *
 * `scaffold.sql` is not a fixture written to trip the checks — it is a recorded
 * `pg_dump` of a database the runtime provisioned from the scaffold template's
 * own collections. That makes this suite the one place where the two halves of
 * the product are compared against each other:
 *
 *   - **the finding set is a product decision.** The scaffold's
 *     `defaultSecurityRules` grant unfiltered reads on purpose (`AUTH_REQUIRE`
 *     still stands in front of them), so a new project's first scan reports
 *     three criticals. That is documented and deliberate; what must never happen
 *     silently is the number changing — in either direction — because someone
 *     edited a template collection or a check's threshold.
 *
 *   - **the remediation must be actionable.** Every policy in this database is
 *     compiled from a collection's `securityRules` and re-applied on every boot.
 *     `ALTER POLICY` on one of them is undone by the next restart, so a fix that
 *     prescribed it would be worse than no fix at all: the operator would watch
 *     the finding disappear and file it as done.
 *
 * Requires Docker. Skips itself when Docker is unavailable, for the same reason
 * `scan.e2e.test.ts` does — with the same `RLS_CHECK_REQUIRE_DOCKER=1` escape
 * for the pipeline, where a skip would be the dangerous outcome.
 */

import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { scan } from "../../src/index";
import type { Finding, ScanResult } from "../../src/types";
import { applySql, isDockerAvailable, startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup";

const dockerAvailable = await isDockerAvailable();

if (!dockerAvailable) {
    if (process.env.RLS_CHECK_REQUIRE_DOCKER === "1") {
        throw new Error(
            "[rls-check e2e] Docker is unavailable and RLS_CHECK_REQUIRE_DOCKER=1 — refusing to skip " +
                "the scaffold baseline."
        );
    }
    console.warn("[rls-check e2e] Docker is not available — skipping the scaffold baseline suite.");
}

/**
 * Every finding a freshly provisioned scaffold produces, as
 * `<severity> <check> <schema>.<table>`.
 *
 * Three unfiltered reads: `posts`, `authors` and `tags` inherit
 * `defaultSecurityRules`, whose select rule is `access: "public"`. `rebase.users`
 * does not — it declares admin-only rules of its own — and `posts_tags`, the
 * junction the many-to-many derives, is scoped to its edges. The five mediums
 * are the container superuser owning the tables, which FORCE cannot constrain
 * and which every self-hosted `docker compose` reproduces.
 */
const EXPECTED_BASELINE = [
    "critical policy-always-true public.authors",
    "critical policy-always-true public.posts",
    "critical policy-always-true public.tags",
    "medium rls-enabled-not-forced public.authors",
    "medium rls-enabled-not-forced public.posts",
    "medium rls-enabled-not-forced public.posts_tags",
    "medium rls-enabled-not-forced public.tags",
    "medium rls-enabled-not-forced rebase.users"
];

const describeFinding = (f: Finding): string =>
    `${f.severity} ${f.id} ${f.target.schema}.${f.target.table ?? f.target.view ?? f.target.routine ?? ""}`;

describe.skipIf(!dockerAvailable)("rls-check against a freshly provisioned scaffold", () => {
    let container: PgContainer;
    let result: ScanResult;

    beforeAll(async () => {
        container = await startPgContainer();
        await applySql(container.connectionString, readFileSync(new URL("./scaffold.sql", import.meta.url), "utf8"));
        result = await scan({ connectionString: container.connectionString });
    });

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    });

    it("recognises the deployment as Rebase, and rebase_user as exposed", () => {
        expect(result.platform).toBe("rebase");
        expect(result.exposedRoles).toEqual(["PUBLIC", "rebase_user"]);
        expect(result.diagnostics.degraded).toEqual([]);
        expect(result.diagnostics.unrecognizedGrantees).toEqual([]);
    });

    it("reads the whole provisioned schema", () => {
        expect(result.stats.schemas).toBe(2);
        expect(result.stats.tables).toBe(14);
        expect(result.stats.policies).toBe(44);
    });

    it("reports exactly the baseline a stock scaffold produces", () => {
        expect(result.findings.map(describeFinding).sort()).toEqual(EXPECTED_BASELINE);
    });

    it("names the collection's rule — never SQL against the policy — for every managed finding", () => {
        const managed = result.findings.filter((f) => f.target.policy);
        // The three unfiltered reads; if this ever becomes 0 the assertions
        // below would pass vacuously.
        expect(managed).toHaveLength(3);

        for (const f of managed) {
            expect(f.fix, describeFinding(f)).toBeDefined();
            expect(f.fix, describeFinding(f)).toContain("securityRules");
            expect(f.fix, describeFinding(f)).toContain(
                "https://rebase.pro/docs/collections/security-rules"
            );
            expect(f.fix, describeFinding(f)).not.toContain("ALTER POLICY");
            expect(f.fix, describeFinding(f)).not.toContain("DROP POLICY");
        }
    });

    it("still prescribes SQL where SQL is the answer", () => {
        // `rls-enabled-not-forced` is about the table, not about a generated
        // policy — the collection config has nothing to say about it, so the
        // fix stays an ALTER TABLE the reader can paste.
        const forced = result.findings.filter((f) => f.id === "rls-enabled-not-forced");
        expect(forced.length).toBeGreaterThan(0);
        for (const f of forced) expect(f.fix).toContain("FORCE ROW LEVEL SECURITY");
    });
});
