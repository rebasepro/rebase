import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { checkPolicyDrift, parseExpectedPolicies, formatPolicyDrift, hasDrift, dropOrphanedPolicies, isGeneratedPolicyName, type PolicyRef, type Queryable } from "./policy-drift";
import { generatePostgresPoliciesDdl } from "../schema/generate-postgres-ddl-logic";

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        schema: "public",
        properties: { id: { name: "ID", type: "string", isId: "uuid" } },
        securityRules: [
            { operation: "select", access: "public" },
            { operations: ["insert", "update", "delete"], roles: ["admin"] }
        ]
    } as unknown as CollectionConfig;
}

/** Stands in for pg_policies. */
function dbWith(rows: Record<string, unknown>[]): Queryable {
    return { query: async () => ({ rows: rows as never[] }) };
}

/** A pg_policies row matching an expected policy, clauses and all. */
function liveRow(p: PolicyRef, overrides: Record<string, unknown> = {}) {
    return {
        schemaname: p.schema, tablename: p.table, policyname: p.name, roles: p.roles, cmd: p.command,
        // Postgres rewrites the text it stores; only presence is compared.
        qual: p.hasUsing ? "(rewritten by postgres)" : null,
        with_check: p.hasWithCheck ? "(rewritten by postgres)" : null,
        ...overrides
    };
}

describe("parseExpectedPolicies", () => {
    it("reads the DDL that db push actually applies", () => {
        const ddl = generatePostgresPoliciesDdl([collection("authors")]);
        const parsed = parseExpectedPolicies(ddl);

        expect(parsed.length).toBeGreaterThan(0);
        const select = parsed.find((p) => p.command === "SELECT" && p.roles.includes("public"));
        expect(select).toMatchObject({ schema: "public", table: "authors", command: "SELECT" });
    });
});

describe("checkPolicyDrift", () => {
    it("reports nothing when the database matches the collections", async () => {
        const cols = [collection("authors")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));

        const drift = await checkPolicyDrift(dbWith(expected.map((p) => liveRow(p))), cols);

        expect(hasDrift(drift)).toBe(false);
        expect(formatPolicyDrift(drift)).toBe("");
    });

    it("flags a policy the database never received as missing", async () => {
        const drift = await checkPolicyDrift(dbWith([]), [collection("authors")]);

        expect(drift.missing.length).toBeGreaterThan(0);
        expect(formatPolicyDrift(drift)).toContain("Missing");
        expect(formatPolicyDrift(drift)).toContain("rebase db push");
    });

    it("flags a stale policy left by an earlier push as orphaned", async () => {
        // The demo's actual bug: test_policy TO authenticated outlived the
        // config that created it, and kept filtering every row.
        const cols = [collection("customers")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = [
            ...expected.map((p) => liveRow(p)),
            { schemaname: "public", tablename: "customers", policyname: "test_policy", roles: ["authenticated"], cmd: "ALL", qual: "true", with_check: null }
        ];

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.orphaned).toHaveLength(1);
        expect(drift.orphaned[0]).toMatchObject({ name: "test_policy", roles: ["authenticated"] });
        expect(formatPolicyDrift(drift)).toContain("Orphaned");
    });

    it("flags a policy whose roles were changed underneath it as diverged", async () => {
        const cols = [collection("orders")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        // Someone re-granted it to a role requests never run as.
        const live = expected.map((p) => liveRow(p, { roles: ["authenticated"] }));

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.diverged.length).toBeGreaterThan(0);
        expect(drift.diverged[0].differences.join(" ")).toContain("roles");
        expect(formatPolicyDrift(drift)).toContain("Diverged");
    });

    it("flags a policy whose expression the database is missing entirely", async () => {
        // A real production database had jobs.public_read_published stored as
        // SELECT / {public} / USING NULL: every field this used to compare
        // matched, drift reported zero, and the policy denied 100% of reads.
        const cols = [collection("jobs")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const select = expected.find((p) => p.command === "SELECT" && p.roles.includes("public"))!;
        const live = expected.map((p) => (p === select ? liveRow(p, { qual: null }) : liveRow(p)));

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.diverged).toHaveLength(1);
        expect(drift.diverged[0].differences.join(" ")).toContain("USING: expected an expression, database has none");
    });

    it("does not mistake an expression Postgres rewrote for a missing one", async () => {
        // The reason expression text is not compared: what comes back out of
        // pg_policies never matches what went in.
        const cols = [collection("posts")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = expected.map((p) => liveRow(p, {
            qual: p.hasUsing ? "((auth.uid() IS NOT NULL) AND ((auth.uid())::text <> 'anonymous'::text))" : null
        }));

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(hasDrift(drift)).toBe(false);
    });

    it("flags the pre-fix permissive tautology that every other check misses", async () => {
        // A database pushed before the `policy.authenticated()` fix carries
        // `auth.uid() IS NOT NULL` — true for anonymous visitors. Its name,
        // roles, command and clause presence all match the corrected policy, so
        // this is the only signal that catches it.
        const cols = [collection("posts")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = expected.map((p) => liveRow(p, {
            qual: p.hasUsing ? "(auth.uid() IS NOT NULL)" : null
        }));

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.insecure.length).toBeGreaterThan(0);
        expect(hasDrift(drift)).toBe(true);
        expect(drift.diverged).toHaveLength(0); // nothing else notices
        expect(formatPolicyDrift(drift)).toContain("anonymous");
        expect(formatPolicyDrift(drift)).toContain("db push");
    });

    it("clears the corrected expression, in either literal spelling", async () => {
        const cols = [collection("posts")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        for (const guard of ["<> 'anonymous'::text", "<> 'anonymous'", "!= 'anonymous'"]) {
            const live = expected.map((p) => liveRow(p, {
                qual: p.hasUsing ? `((auth.uid() IS NOT NULL) AND ((auth.uid())::text ${guard}))` : null
            }));
            const drift = await checkPolicyDrift(dbWith(live), cols);
            expect(drift.insecure).toHaveLength(0);
        }
    });

    it("also flags the tautology in a WITH CHECK clause", async () => {
        const cols = [collection("posts")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = expected.map((p) => liveRow(p, {
            with_check: p.hasWithCheck ? "(auth.uid() IS NOT NULL)" : null
        }));

        const drift = await checkPolicyDrift(dbWith(live), cols);

        const flagged = drift.insecure.some((i) => /WITH CHECK/.test(i.reason));
        // Only assert when the fixture actually had a WITH CHECK policy to carry it.
        if (expected.some((p) => p.hasWithCheck)) expect(flagged).toBe(true);
    });

    it("parses roles when the driver returns the raw {a,b} text form", async () => {
        const cols = [collection("tags")];
        const live = [{ schemaname: "public", tablename: "tags", policyname: "test_policy", roles: "{authenticated,anon}", cmd: "ALL", qual: "true", with_check: null }];

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.orphaned[0].roles).toEqual(["authenticated", "anon"]);
    });

    it("reports nothing when there are no collections at all", async () => {
        // With no collections there is no expectation to reconcile against, so
        // scanning would report every policy in the database as orphaned.
        // Note a collection with no securityRules is NOT this case — it still
        // generates default (admin-only) policies.
        const drift = await checkPolicyDrift(
            dbWith([{ schemaname: "public", tablename: "x", policyname: "p", roles: ["public"], cmd: "ALL", qual: "true", with_check: null }]),
            []
        );

        expect(hasDrift(drift)).toBe(false);
    });

    it("still expects the default policies a collection without securityRules generates", async () => {
        const bare = { name: "x", slug: "x", table: "x", schema: "public", properties: {} } as unknown as CollectionConfig;

        const drift = await checkPolicyDrift(dbWith([]), [bare]);

        // Locked-by-default: absence of rules means admin-only policies, not none.
        expect(drift.missing.length).toBeGreaterThan(0);
    });
});

describe("isGeneratedPolicyName", () => {
    it("recognises the generator's own shape", () => {
        expect(isGeneratedPolicyName("documents_insert_a1b2c3d", "documents")).toBe(true);
        // One rule spanning several operations appends the operation index.
        expect(isGeneratedPolicyName("documents_update_a1b2c3d_1", "documents")).toBe(true);
    });

    it("does not claim names a human could have written", () => {
        expect(isGeneratedPolicyName("owner_access", "documents")).toBe(false);
        expect(isGeneratedPolicyName("documents_default_admin_read", "documents")).toBe(false);
        // Right shape, wrong table — belongs to something else.
        expect(isGeneratedPolicyName("teams_insert_a1b2c3d", "documents")).toBe(false);
        // A digest is 7 lowercase hex characters, nothing else.
        expect(isGeneratedPolicyName("documents_insert_notahex", "documents")).toBe(false);
        expect(isGeneratedPolicyName("documents_grant_a1b2c3d", "documents")).toBe(false);
    });
});

describe("dropOrphanedPolicies", () => {
    /** Records the DDL issued so the test can assert on what was dropped. */
    function recordingDb(rows: Record<string, unknown>[]) {
        const executed: string[] = [];
        const db: Queryable = {
            query: async (text: string) => {
                if (!/^SELECT/i.test(text)) executed.push(text);
                return { rows: rows as never[] };
            }
        };
        return { db, executed };
    }

    it("drops the policy a rule edit superseded", async () => {
        // The reported failure: tightening a rule renames its policy, and the
        // permissive original stays live and keeps ORing itself back in.
        const cols = [collection("documents")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const stale = {
            schemaname: "public", tablename: "documents", policyname: "documents_insert_dead1ee",
            roles: ["public"], cmd: "INSERT", qual: null, with_check: "true"
        };
        const live = [...expected.map((p) => liveRow(p)), stale];

        const drift = await checkPolicyDrift(dbWith(live), cols);
        const { db, executed } = recordingDb(live);
        const { dropped, kept } = await dropOrphanedPolicies(db, drift, cols);

        expect(dropped).toHaveLength(1);
        expect(dropped[0].name).toBe("documents_insert_dead1ee");
        expect(kept).toHaveLength(0);
        expect(executed).toEqual([
            'DROP POLICY IF EXISTS "documents_insert_dead1ee" ON "public"."documents"'
        ]);
    });

    it("leaves a hand-written policy alone and reports it instead", async () => {
        const cols = [collection("documents")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = [
            ...expected.map((p) => liveRow(p)),
            { schemaname: "public", tablename: "documents", policyname: "ops_break_glass", roles: ["public"], cmd: "ALL", qual: "true", with_check: null }
        ];

        const drift = await checkPolicyDrift(dbWith(live), cols);
        const { db, executed } = recordingDb(live);
        const { dropped, kept } = await dropOrphanedPolicies(db, drift, cols);

        expect(dropped).toHaveLength(0);
        expect(kept.map((p) => p.name)).toEqual(["ops_break_glass"]);
        expect(executed).toEqual([]);
    });

    it("never touches a table the collections do not describe", async () => {
        // Another application sharing the schema owns this table; a
        // generator-shaped name there is coincidence, not our leftover.
        const cols = [collection("documents")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = [
            ...expected.map((p) => liveRow(p)),
            { schemaname: "public", tablename: "legacy", policyname: "legacy_select_a1b2c3d", roles: ["public"], cmd: "SELECT", qual: "true", with_check: null }
        ];

        const drift = await checkPolicyDrift(dbWith(live), cols);
        const { db, executed } = recordingDb(live);
        const { dropped, kept } = await dropOrphanedPolicies(db, drift, cols);

        expect(dropped).toHaveLength(0);
        expect(kept.map((p) => p.name)).toEqual(["legacy_select_a1b2c3d"]);
        expect(executed).toEqual([]);
    });

    it("does nothing when the database already matches", async () => {
        const cols = [collection("documents")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = expected.map((p) => liveRow(p));

        const drift = await checkPolicyDrift(dbWith(live), cols);
        const { db, executed } = recordingDb(live);
        const { dropped, kept } = await dropOrphanedPolicies(db, drift, cols);

        expect(dropped).toHaveLength(0);
        expect(kept).toHaveLength(0);
        expect(executed).toEqual([]);
    });
});
