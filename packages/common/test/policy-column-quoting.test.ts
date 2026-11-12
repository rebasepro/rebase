/**
 * Column references in a compiled policy body must name the column.
 *
 * The compiler wrote `quoteLiteral` for the value side and nothing at all for
 * the identifier side, so a column whose name Postgres does not read back
 * unchanged reached `CREATE POLICY` bare. The three outcomes are ordered by how
 * long they take to notice, and only the first two announce themselves:
 *
 *   "createdAt"  → folded to `createdat`; CREATE POLICY errors, table denies
 *   "order"      → syntax error mid-clause
 *   "user"       → compiles, applies, and compares `current_user`
 *
 * The last one is the reason this is a correctness fix and not a tidying one:
 * every RLS request runs as the same `rebase_user` role, so the clause is a
 * constant. It denies every row, and its negation admits every row, while the
 * deploy logs a policy applied successfully.
 *
 * These names are not exotic. `columnName` is used verbatim and
 * `rebase schema introspect` populates it from the live database, so any
 * camelCase table adopted from an existing project arrives spelled this way.
 */
import { describe, it, expect } from "@jest/globals";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { policy, CollectionConfig } from "@rebasepro/types";

/** A collection introspected from a camelCase database, plus two keyword columns. */
const legacyDocs: CollectionConfig = {
    slug: "docs",
    name: "Docs",
    properties: {
        createdAt: { type: "date", name: "Created", columnName: "createdAt" },
        ownerId: { type: "string", name: "Owner", columnName: "ownerId" },
        user: { type: "string", name: "User" },
        order: { type: "number", name: "Order" }
    }
};

/** No `columnName`, ordinary keys — the shape every existing policy has. */
const plainDocs: CollectionConfig = {
    slug: "documents",
    name: "Documents",
    properties: {
        team_id: { type: "string", name: "Team" },
        owner_id: { type: "string", name: "Owner" }
    }
};

describe("policyToPostgres — column identifiers", () => {

    it("quotes a case-sensitive column so Postgres does not fold it away", () => {
        const sql = policyToPostgres(
            policy.compare(policy.field("ownerId"), "eq", policy.authUid()),
            legacyDocs
        );
        expect(sql).toBe(`("ownerId")::text = (SELECT rebase.uid())`);
    });

    it("quotes a column named after a bare SQL expression", () => {
        // `user` unquoted is `current_user`: the clause compiles and compares
        // the connected role, which under RLS is the same for every caller.
        const sql = policyToPostgres(
            policy.compare(policy.field("user"), "eq", policy.literal("alice")),
            legacyDocs
        );
        expect(sql).toBe(`"user" = 'alice'`);
        expect(sql).not.toMatch(/(^|[^"])\buser\b(?!")/);
    });

    it("quotes a column named after a reserved keyword", () => {
        const sql = policyToPostgres(
            policy.compare(policy.field("order"), "gt", policy.literal(1)),
            legacyDocs
        );
        expect(sql).toBe(`"order" > 1`);
    });

    it("quotes the column inside a raw clause's {column} substitution", () => {
        const sql = policyToPostgres(
            policy.raw("{createdAt} < now()"),
            legacyDocs
        );
        expect(sql).toBe(`"public"."docs"."createdAt" < now()`);
    });

    it("quotes an existsIn subquery's inner and outer columns alike", () => {
        const members: CollectionConfig = {
            slug: "members", name: "Members",
            properties: { docId: { type: "string", name: "Doc", columnName: "docId" } }
        };

        const sql = policyToPostgres(
            policy.existsIn({
                table: "members",
                where: policy.compare(policy.field("docId"), "eq", policy.outerField("createdAt"))
            }),
            legacyDocs,
            { resolveCollection: (slug) => (slug === "members" ? members : undefined) }
        );
        expect(sql).toContain(`"_ex0"."docId"`);
        expect(sql).toContain(`"public"."docs"."createdAt"`);
    });

    it("escapes an embedded double quote rather than closing the identifier", () => {
        const odd: CollectionConfig = {
            slug: "odd", name: "Odd",
            properties: { weird: { type: "string", name: "Weird", columnName: 'we"ird' } }
        };

        const sql = policyToPostgres(policy.compare(policy.field("weird"), "eq", policy.literal("x")), odd);
        expect(sql).toBe(`"we""ird" = 'x'`);
    });

    /**
     * The other half of the contract: an ordinary snake_case body must come out
     * exactly as it always has. Policies already written into shipped databases
     * are compared against freshly compiled ones, and generated artifacts are
     * diffed by a repo gate — a fix that reformats every clause in the codebase
     * to reach the few that were broken is a worse trade than the bug.
     */
    it("leaves an ordinary snake_case column unquoted, byte for byte", () => {
        const sql = policyToPostgres(
            policy.and(
                policy.compare(policy.field("owner_id"), "eq", policy.authUid()),
                policy.compare(policy.field("team_id"), "neq", policy.literal("none"))
            ),
            plainDocs
        );
        expect(sql).toBe(`((owner_id)::text = (SELECT rebase.uid())) AND (team_id != 'none')`);
    });

    it("leaves a snake_cased property key unquoted", () => {
        // No `columnName`: the key is snake_cased, and the result is already safe.
        const sql = policyToPostgres(
            policy.compare(policy.field("teamId"), "eq", policy.literal("t1")),
            plainDocs
        );
        expect(sql).toBe(`team_id = 't1'`);
    });
});
