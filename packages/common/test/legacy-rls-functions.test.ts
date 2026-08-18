/**
 * The `auth.*` → `rebase.*` move, from the perspective of a project that was
 * written before it.
 *
 * Rebase's RLS helpers used to live in a schema called `auth` — Supabase's name,
 * borrowed for familiarity, and unusable on any database that already had one:
 * `CREATE OR REPLACE FUNCTION auth.uid() RETURNS text` cannot be applied over
 * Supabase's `RETURNS uuid`, and the failure was swallowed. They live in
 * `rebase` now, the one schema Rebase creates.
 *
 * That is a breaking rename of a string users can write by hand, in the one
 * place where getting it wrong fails *open-ended*: a policy that calls a
 * missing function does not fail loudly at compile time, it denies every row at
 * runtime. So the compiler accepts the old spelling and rewrites it, the parser
 * reads it, and the boot warns once. These pin all three.
 */
import { describe, it, expect } from "@jest/globals";
import { policy, rewriteLegacyRlsFunctions, usesLegacyRlsFunctions } from "@rebasepro/types";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { sqlToPolicy, findAnonymousGrants } from "../src/util/policy/sqlToPolicy";
import { buildCollectionFromTableMetadata } from "../src/util/pg-column-to-property";

describe("rewriteLegacyRlsFunctions", () => {
    it("rewrites all three helpers, in any case", () => {
        expect(rewriteLegacyRlsFunctions("auth.uid()")).toBe("rebase.uid()");
        expect(rewriteLegacyRlsFunctions("AUTH.JWT()")).toBe("rebase.jwt()");
        expect(rewriteLegacyRlsFunctions("auth.roles( )")).toBe("rebase.roles()");
    });

    it("leaves anything that merely looks like them alone", () => {
        // A column, a table, and another schema's function that happens to sit
        // next to the word. Rewriting any of these would corrupt a policy that
        // was correct.
        for (const sql of ["auth_uid", "my_auth.uid()", "authority.uid()", "t.auth", "\"auth\".\"users\".id"]) {
            expect(rewriteLegacyRlsFunctions(sql)).toBe(sql);
        }
    });

    it("detects without rewriting", () => {
        expect(usesLegacyRlsFunctions("owner = auth.uid()")).toBe(true);
        expect(usesLegacyRlsFunctions("owner = rebase.uid()")).toBe(false);
        expect(usesLegacyRlsFunctions("auth_uid = 1")).toBe(false);
    });
});

describe("the compiler accepts a pre-1.0 raw rule", () => {
    it("emits the current spelling from raw SQL written against the old one", () => {
        const compiled = policyToPostgres(policy.raw("owner_id = auth.uid()"));
        expect(compiled).toBe("owner_id = rebase.uid()");
    });

    it("still substitutes {column} placeholders around it", () => {
        const compiled = policyToPostgres(
            policy.raw("{ownerId} = auth.uid()"),
            { slug: "posts", table: "posts", name: "Posts", properties: { ownerId: { type: "string", columnName: "owner_id" } } } as never
        );
        expect(compiled).toContain("owner_id");
        expect(compiled).toContain("rebase.uid()");
        expect(compiled).not.toContain("auth.uid()");
    });

    it("compiles structured rules to the new spelling regardless", () => {
        // These never carried a schema name — they are the reason the structured
        // helpers exist, and the migration costs their users nothing.
        expect(policyToPostgres(policy.serverContext())).toBe("rebase.uid() IS NULL");
        expect(policyToPostgres(policy.rolesOverlap(["admin"])))
            .toBe("string_to_array(rebase.roles(), ',') && ARRAY['admin']");
    });
});

describe("the parser reads policies written by an older release", () => {
    it("recognises a legacy roles-overlap body as a structured rule", () => {
        // Read back out of a live database that has not been recompiled yet. If
        // this fell through to `raw`, the Studio would badge Rebase's own
        // policies as hand-written drift.
        const parsed = sqlToPolicy("string_to_array(auth.roles(), ',') && ARRAY['admin']");
        expect(parsed).toEqual(policy.rolesOverlap(["admin"]));
    });

    it("recognises a legacy uid comparison", () => {
        const parsed = sqlToPolicy("owner_id = auth.uid()");
        expect(parsed).toEqual(policy.compare(policy.field("owner_id"), "eq", policy.authUid()));
    });

    it("normalises the spelling even when it falls through to raw", () => {
        // Unparseable as a structured rule, so it is stored verbatim — and
        // "verbatim" has to mean the current spelling, or editing a legacy
        // policy in the Studio would write back a call to a dropped function.
        const parsed = sqlToPolicy("something_unparseable(auth.uid(), x) > 3");
        expect(parsed.kind).toBe("raw");
        expect((parsed as { sql: string }).sql).toContain("rebase.uid()");
        expect((parsed as { sql: string }).sql).not.toContain("auth.uid()");
    });

    it("normalises what the table importer copies out of the catalogue", () => {
        // The importer reads `pg_policies` and writes the result into the
        // project's own config. That is the one path where a legacy spelling
        // does not just get read — it gets *authored*, into a file the user then
        // owns, and every boot afterwards warns about a rule they never typed.
        const imported = buildCollectionFromTableMetadata("posts", {
            columns: [],
            policies: [{
                policy_name: "posts_owner_select",
                roles: ["authenticated"],
                cmd: "SELECT",
                qual: "author_id = auth.uid()",
                with_check: "author_id = auth.uid()"
            }]
        } as never);

        const rule = imported.securityRules?.[0] as { using?: string; withCheck?: string };
        expect(rule.using).toBe("author_id = rebase.uid()");
        expect(rule.withCheck).toBe("author_id = rebase.uid()");
    });

    it("still flags the anonymous tautology in a legacy body", () => {
        // The security check must not stop recognising a dangerous clause just
        // because the framework renamed a function.
        const risks = findAnonymousGrants(policy.raw("auth.uid() IS NOT NULL"));
        expect(risks).toHaveLength(1);
        expect(risks[0].pattern).toBe("uid-not-null");
    });
});
