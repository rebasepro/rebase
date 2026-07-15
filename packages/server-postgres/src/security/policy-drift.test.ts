import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { checkPolicyDrift, parseExpectedPolicies, formatPolicyDrift, hasDrift, type Queryable } from "./policy-drift";
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
        const live = expected.map((p) => ({
            schemaname: p.schema, tablename: p.table, policyname: p.name, roles: p.roles, cmd: p.command
        }));

        const drift = await checkPolicyDrift(dbWith(live), cols);

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
            ...expected.map((p) => ({ schemaname: p.schema, tablename: p.table, policyname: p.name, roles: p.roles, cmd: p.command })),
            { schemaname: "public", tablename: "customers", policyname: "test_policy", roles: ["authenticated"], cmd: "ALL" }
        ];

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.orphaned).toHaveLength(1);
        expect(drift.orphaned[0]).toMatchObject({ name: "test_policy", roles: ["authenticated"] });
        expect(formatPolicyDrift(drift)).toContain("Orphaned");
    });

    it("flags a policy whose roles were changed underneath it as diverged", async () => {
        const cols = [collection("orders")];
        const expected = parseExpectedPolicies(generatePostgresPoliciesDdl(cols));
        const live = expected.map((p) => ({
            schemaname: p.schema, tablename: p.table, policyname: p.name,
            // Someone re-granted it to a role requests never run as.
            roles: ["authenticated"], cmd: p.command
        }));

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.diverged.length).toBeGreaterThan(0);
        expect(drift.diverged[0].differences.join(" ")).toContain("roles");
        expect(formatPolicyDrift(drift)).toContain("Diverged");
    });

    it("parses roles when the driver returns the raw {a,b} text form", async () => {
        const cols = [collection("tags")];
        const live = [{ schemaname: "public", tablename: "tags", policyname: "test_policy", roles: "{authenticated,anon}", cmd: "ALL" }];

        const drift = await checkPolicyDrift(dbWith(live), cols);

        expect(drift.orphaned[0].roles).toEqual(["authenticated", "anon"]);
    });

    it("reports nothing when there are no collections at all", async () => {
        // With no collections there is no expectation to reconcile against, so
        // scanning would report every policy in the database as orphaned.
        // Note a collection with no securityRules is NOT this case — it still
        // generates default (admin-only) policies.
        const drift = await checkPolicyDrift(
            dbWith([{ schemaname: "public", tablename: "x", policyname: "p", roles: ["public"], cmd: "ALL" }]),
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
