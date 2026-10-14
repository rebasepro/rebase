import { describe, it, expect } from "@jest/globals";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { evaluatePolicy } from "../src/util/policy/evaluatePolicy";
import { findAnonymousGrants, sqlToPolicy } from "../src/util/policy/sqlToPolicy";
import { ANONYMOUS_USER_ID, policy, CollectionConfig } from "@rebasepro/types";

const documents: CollectionConfig = {
    id: "documents",
    slug: "documents",
    name: "Documents",
    path: "documents",
    properties: { team_id: { dataType: "string", name: "Team" } }
} as unknown as CollectionConfig;

const teamMembers: CollectionConfig = {
    id: "team_members",
    slug: "team_members",
    name: "Team Members",
    path: "team_members",
    properties: {
        team_id: { dataType: "string", name: "Team" },
        user_id: { dataType: "string", name: "User" }
    }
} as unknown as CollectionConfig;

const resolveCollection = (slug: string) => [documents, teamMembers].find(c => c.slug === slug);

describe("policyToPostgres — existsIn (membership)", () => {
    it("compiles a correlated EXISTS subquery scoping reads to the caller's teams", () => {
        const expr = policy.existsIn({
            collection: "team_members",
            where: policy.and(
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                policy.compare(policy.field("user_id"), "eq", policy.authUid())
            )
        });

        const sql = policyToPostgres(expr, documents, { resolveCollection });

        // Subquery over the join table, aliased.
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."team_members" "_ex0" WHERE`);
        // inner `field` binds to the aliased join table
        expect(sql).toContain(`"_ex0".team_id`);
        expect(sql).toContain(`("_ex0".user_id)::text = (SELECT rebase.uid())`);
        // `outerField` binds to the outer RLS row, table-qualified
        expect(sql).toContain(`"public"."documents".team_id`);
    });

    it("falls back to a snake_cased table name when the collection can't be resolved", () => {
        const expr = policy.existsIn({
            collection: "teamMembers",
            where: policy.compare(policy.field("userId"), "eq", policy.authUid())
        });
        const sql = policyToPostgres(expr, documents);
        expect(sql).toContain(`FROM "public"."team_members" "_ex0"`);
        expect(sql).toContain(`("_ex0".user_id)::text = (SELECT rebase.uid())`);
    });

    it("does not regress non-existsIn compilation (bare columns at top level)", () => {
        const expr = policy.compare(policy.field("team_id"), "eq", policy.authUid());
        expect(policyToPostgres(expr, documents)).toBe("(team_id)::text = (SELECT rebase.uid())");
    });

    it("is treated as server-authoritative (unknown) by the JS evaluator", () => {
        const expr = policy.existsIn({
            collection: "team_members",
            where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
        });
        expect(evaluatePolicy(expr, { uid: "u1",
roles: [],
entity: null })).toBe("unknown");
    });
});

describe("policyToPostgres — raw escape hatch", () => {
    it("qualifies {column} with the outer table so it cannot bind to a subquery alias", () => {
        // Regression: `{team_id}` used to compile to a bare `team_id`, which
        // Postgres resolves against the innermost scope — turning the correlation
        // into `m.team_id = m.team_id`, a tautology that matched every row and
        // leaked other tenants' data.
        const expr = policy.raw(
            "EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = {team_id} AND m.user_id = rebase.uid())"
        );
        const sql = policyToPostgres(expr, documents);
        expect(sql).toContain(`m.team_id = "public"."documents".team_id`);
        expect(sql).not.toContain("m.team_id = team_id");
    });

    it("qualifies {column} at the top level too", () => {
        const expr = policy.raw("{team_id} IS NOT NULL");
        expect(policyToPostgres(expr, documents)).toBe(`"public"."documents".team_id IS NOT NULL`);
    });

    it("leaves raw SQL without placeholders untouched", () => {
        const expr = policy.raw("rebase.uid() IS NOT NULL");
        expect(policyToPostgres(expr, documents)).toBe("rebase.uid() IS NOT NULL");
    });

    it("does not read a regex quantifier in a string literal as a placeholder", () => {
        // The shape a stored claim-tenancy policy on a uuid column imports as:
        // its guard regex has `{8}` and `{12}`, which became
        // `"public"."documents"."8"`, so the guard never matched and the
        // imported policy denied every tenant.
        const guard = "'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'";
        const claim = "NULLIF((rebase.jwt() ->> 'org'::text), ''::text)";
        const sql = `{team_id} = CASE WHEN (${claim} ~ ${guard}::text) THEN (${claim})::uuid ELSE NULL::uuid END`;

        expect(policyToPostgres(policy.raw(sql), documents)).toBe(`"public"."documents".team_id${sql.slice("{team_id}".length)}`);
    });

    it("substitutes only outside literals, quoted identifiers and comments", () => {
        const cases: [string, string][] = [
            ["{team_id} = 'it''s {team_id}'", `"public"."documents".team_id = 'it''s {team_id}'`],
            ["{team_id} = E'it\\'s {team_id}'", `"public"."documents".team_id = E'it\\'s {team_id}'`],
            ["{team_id} = $$ {team_id} $$", `"public"."documents".team_id = $$ {team_id} $$`],
            ["{team_id} = $q$ {team_id} $q$", `"public"."documents".team_id = $q$ {team_id} $q$`],
            [`"{team_id}" = {team_id}`, `"{team_id}" = "public"."documents".team_id`],
            ["{team_id} IS NULL -- don't {team_id}\nOR {team_id} = '1'", `"public"."documents".team_id IS NULL -- don't {team_id}\nOR "public"."documents".team_id = '1'`],
            ["/* it's {team_id} */ {team_id} = '1'", `/* it's {team_id} */ "public"."documents".team_id = '1'`],
            // `$1` is a parameter, not a dollar quote; `x$y$` an identifier.
            ["{team_id} = $1 AND x$y$ = {team_id}", `"public"."documents".team_id = $1 AND x$y$ = "public"."documents".team_id`]
        ];
        for (const [raw, compiled] of cases) {
            expect([raw, policyToPostgres(policy.raw(raw), documents)]).toEqual([raw, compiled]);
        }
    });
});

describe("policy.authenticated()", () => {
    // `IS NOT NULL` alone is a tautology on the user path: the driver reports an
    // anonymous request as ANONYMOUS_USER_ID, never NULL. A rule reading as
    // "logged-in users only" therefore used to grant to anonymous visitors.
    it("excludes every anonymous sentinel, not just NULL and not just one spelling", () => {
        // Both literals, because a policy is written into the database and
        // outlives the server that compiled it: this clause may be enforced by
        // a server still reporting the legacy `'anon'`. Excluding one spelling
        // is exactly how this helper became a grant.
        expect(policyToPostgres(policy.authenticated()))
            .toBe("(SELECT rebase.uid()) IS NOT NULL AND (SELECT rebase.uid()) NOT IN ('anonymous', 'anon')");
    });

    it("is false for an anonymous caller, in either spelling", () => {
        expect(evaluatePolicy(policy.authenticated(), { uid: null, entity: null })).toBe(false);
        expect(evaluatePolicy(policy.authenticated(), { uid: ANONYMOUS_USER_ID, entity: null })).toBe(false);
        // The spelling the request path used to report. A client evaluating it
        // as "signed in" renders rows the database will refuse.
        expect(evaluatePolicy(policy.authenticated(), { uid: "anon", entity: null })).toBe(false);
    });

    it("is true for a signed-in caller", () => {
        expect(evaluatePolicy(policy.authenticated(), { uid: "u1", entity: null })).toBe(true);
    });

    it("negates honestly — no special case rewriting it to the server context", () => {
        // `not(authenticated())` used to compile to `rebase.uid() IS NULL`, i.e.
        // "is the server context". It means "anonymous or server" now, and
        // `serverContext()` is how you ask the narrower question.
        expect(policyToPostgres(policy.not(policy.authenticated())))
            .toBe("(SELECT NOT (rebase.uid() IS NOT NULL AND rebase.uid() NOT IN ('anonymous', 'anon')))");
    });
});

describe("policy.serverContext()", () => {
    it("compiles to the only state a user request cannot reach", () => {
        expect(policyToPostgres(policy.serverContext())).toBe("(SELECT rebase.uid() IS NULL)");
    });

    it("is false client-side for every caller — a client is never the server", () => {
        expect(evaluatePolicy(policy.serverContext(), { uid: null, entity: null })).toBe(false);
        expect(evaluatePolicy(policy.serverContext(), { uid: "u1", entity: null })).toBe(false);
    });

    it("keeps the default server-or-admin grant away from anonymous callers", () => {
        // The framework's own baseline policy, on every collection. With
        // `not(authenticated())` in place of `serverContext()` this is true.
        const serverOrAdmin = policy.or(policy.serverContext(), policy.rolesOverlap(["admin"]));
        expect(evaluatePolicy(serverOrAdmin, { uid: null, roles: [], entity: null })).toBe(false);
        expect(evaluatePolicy(serverOrAdmin, { uid: "u1", roles: ["admin"], entity: null })).toBe(true);
    });
});

describe("authUid operand", () => {
    it("resolves to the sentinel for an anonymous caller, matching rebase.uid()", () => {
        // Postgres compares against 'anonymous'; resolving to null here would
        // make the two disagree on exactly the rules that test for it.
        const notAnon = policy.compare(policy.authUid(), "neq", policy.literal(ANONYMOUS_USER_ID));
        expect(evaluatePolicy(notAnon, { uid: null, entity: null })).toBe(false);
        expect(evaluatePolicy(notAnon, { uid: "u1", entity: null })).toBe(true);
    });
});

/*
 * Keyword detection has to see word boundaries.
 *
 * `isKeywordAt` exists so that a column named `brand` is not split into
 * `br AND d`, and `border` into `b OR der`. Nothing tested it: mutation flipped
 * the `&&` joining the before/after boundary checks to `||` — which makes a
 * keyword match whenever *either* side is a boundary — and the whole package
 * suite stayed green.
 *
 * This parser has already shipped one real defect (an AND hoisted out of an
 * EXISTS), and it decides how a security rule is understood, so a
 * mis-tokenised column name is not a cosmetic failure.
 */
describe("sqlToPolicy tokenises on word boundaries", () => {
    const roundTrips = (sql: string) => {
        const expr = sqlToPolicy(sql);
        // A rule it cannot parse is preserved verbatim as `raw`; that is the
        // documented fallback and is what a mis-tokenised name must NOT do
        // silently in the middle of an otherwise-parsed expression.
        return expr;
    };

    it.each([
        ["brand", "a column containing AND"],
        ["border", "a column containing OR"],
        ["notes", "a column containing NOT"],
        ["android_id", "AND at the start"],
        ["organisation", "OR at the start"]
    ])("does not split %s (%s)", (column) => {
        const expr = roundTrips(`${column} = 'x'`);

        // Whatever shape it produces, it must be ONE comparison — not an
        // and/or tree invented out of the column's own letters.
        expect(expr.kind).not.toBe("and");
        expect(expr.kind).not.toBe("or");
    });

    it("still splits on a real keyword with spaces around it", () => {
        expect(sqlToPolicy("a = 'x' AND b = 'y'").kind).toBe("and");
        expect(sqlToPolicy("a = 'x' OR b = 'y'").kind).toBe("or");
    });

    it("still splits on a keyword bounded by parentheses rather than spaces", () => {
        // The boundary class is [\s()], so `(a = 'x')AND(b = 'y')` is a real
        // conjunction even with no whitespace.
        expect(sqlToPolicy("(a = 'x')AND(b = 'y')").kind).toBe("and");
    });
});

describe("findAnonymousGrants", () => {
    const patterns = (sql: string) => findAnonymousGrants(sqlToPolicy(sql)).map(r => r.pattern);

    it("catches the bare tautology, which has no literal to give it away", () => {
        // `rebase.uid() IS NOT NULL` is the most natural way to write "logged in",
        // and it is true for every caller including anonymous ones.
        expect(patterns("rebase.uid() IS NOT NULL")).toEqual(["uid-not-null"]);
    });

    it("catches the Supabase habit that inverts a rule", () => {
        // `rebase.uid() != 'anon'` compares against a string no caller ever has.
        expect(findAnonymousGrants(sqlToPolicy("rebase.uid() != 'anon'")))
            .toEqual([expect.objectContaining({ pattern: "foreign-uid-literal", detail: "anon" })]);
    });

    it("catches both halves of the rule from the wild", () => {
        // The exact `using:` string found across 8 collections of PII, which
        // reads as a lockdown and grants everything to anonymous visitors.
        expect(patterns("rebase.uid() IS NOT NULL AND rebase.uid() != 'anon'").sort())
            .toEqual(["foreign-uid-literal", "uid-not-null"]);
    });

    it("finds them nested inside AND/OR and in structured rules", () => {
        const expr = policy.and(
            policy.compare(policy.field("owner_id"), "eq", policy.authUid()),
            policy.or(
                policy.compare(policy.authUid(), "neq", policy.literal("service_role")),
                policy.compare(policy.literal("authenticated"), "eq", policy.authUid())
            )
        );
        expect(findAnonymousGrants(expr).map(r => r.detail).sort())
            .toEqual(["authenticated", "service_role"]);
    });

    it("says nothing about correct rules", () => {
        // The sentinel itself is the right thing to compare against.
        expect(patterns(`rebase.uid() != '${ANONYMOUS_USER_ID}'`)).toEqual([]);
        expect(patterns("owner_id = rebase.uid()")).toEqual([]);
        // A literal not compared against rebase.uid() is just a value.
        expect(patterns("role = 'anon'")).toEqual([]);
        // And the primitive that exists precisely to get this right.
        expect(findAnonymousGrants(policy.authenticated())).toEqual([]);
    });
});

describe("sqlToPolicy → policyToPostgres round-trip", () => {
    // The parser's output is re-emitted as DDL, so a clause it only partly
    // understands must survive verbatim rather than be decomposed. Splitting on
    // a nested AND/OR used to hoist it out of its subquery and produce SQL that
    // Postgres rejects with "missing FROM-clause entry for table".
    const roundTrip = (sql: string) => policyToPostgres(sqlToPolicy(sql));

    it("keeps AND inside an EXISTS subquery where it belongs", () => {
        const sql =
            "EXISTS (SELECT 1 FROM organizations JOIN organization_members ON organizations.id = organization_members.organization_id WHERE organizations.billing_account_id = billing_accounts.id AND organization_members.user_id = rebase.uid())";
        const out = roundTrip(sql);
        expect(out).toContain("billing_accounts.id AND organization_members.user_id = rebase.uid()");
        // The correlated column must not escape the subquery.
        expect(out).not.toMatch(/\)\s*AND\s*\(?organization_members\.user_id/);
    });

    it("keeps OR inside a subquery", () => {
        const sql = "EXISTS (SELECT 1 FROM m WHERE m.a = t.a OR m.b = t.b)";
        expect(roundTrip(sql)).toContain("m.a = t.a OR m.b = t.b");
    });

    it("does not split on AND inside a string literal", () => {
        const sql = "status = 'draft AND pending'";
        expect(roundTrip(sql)).toContain("'draft AND pending'");
    });

    it("still splits genuine top-level AND", () => {
        expect(roundTrip("a = 'x' AND b = 'y'")).toBe("(a = 'x') AND (b = 'y')");
    });

    it("still splits genuine top-level OR", () => {
        expect(roundTrip("a = 'x' OR b = 'y'")).toBe("(a = 'x') OR (b = 'y')");
    });

    it("splits a top-level AND between two parenthesised subqueries", () => {
        const out = roundTrip("EXISTS (SELECT 1 FROM a WHERE a.x = 1) AND EXISTS (SELECT 1 FROM b WHERE b.y = 2)");
        expect(out).toContain("EXISTS (SELECT 1 FROM a WHERE a.x = 1)");
        expect(out).toContain("EXISTS (SELECT 1 FROM b WHERE b.y = 2)");
    });
});

/**
 * What does not read the row is evaluated once per statement, as an initPlan.
 *
 * Postgres evaluates a policy's qual per row and estimates `rebase.uid() IS
 * NULL OR roles && …` to pass 1.5% of a table, which turns a deep page into a
 * sequential scan and an on-disk sort of the whole table. A scalar subquery
 * that references no column is computed once and estimated at 50%. These pin
 * where the compiler puts it; `policy-shapes-equivalence.test.ts` in
 * server-postgres runs every shape against Postgres to show the rows admitted
 * are the same.
 */
describe("policyToPostgres — row-independent parts become initPlans", () => {
    const owned = { slug: "notes", name: "Notes", properties: { ownerId: { type: "string", columnName: "owner_id" } } } as unknown as CollectionConfig;

    it("wraps the whole server-or-admin baseline in one subquery", () => {
        expect(policyToPostgres(policy.or(policy.serverContext(), policy.rolesOverlap(["admin"]))))
            .toBe("(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))");
    });

    it("wraps only the caller's side of a comparison with a column", () => {
        expect(policyToPostgres(policy.compare(policy.field("ownerId"), "eq", policy.authUid()), owned))
            .toBe("(owner_id)::text = (SELECT rebase.uid())");
        expect(policyToPostgres(policy.compare(policy.field("ownerId"), "eq", policy.authClaim("sub")), owned))
            .toBe("owner_id = (SELECT NULLIF(rebase.jwt() ->> 'sub', ''))");
    });

    it("wraps each row-independent operand of a mixed OR, and leaves the row's own", () => {
        const sql = policyToPostgres(policy.or(
            policy.serverContext(),
            policy.compare(policy.field("ownerId"), "eq", policy.authUid())
        ), owned);
        expect(sql).toBe("((SELECT rebase.uid() IS NULL)) OR ((owner_id)::text = (SELECT rebase.uid()))");
    });

    it("never wraps a subtree that reads the row, a raw clause, or a constant", () => {
        expect(policyToPostgres(policy.compare(policy.field("ownerId"), "eq", policy.literal("x")), owned))
            .toBe("owner_id = 'x'");
        expect(policyToPostgres(policy.raw("owner_id = rebase.uid()"))).toBe("owner_id = rebase.uid()");
        expect(policyToPostgres(policy.and(policy.true(), policy.false()))).toBe("(true) AND (false)");
    });

    it("hoists inside a correlated EXISTS, without hoisting the EXISTS", () => {
        const sql = policyToPostgres(policy.existsIn({
            collection: "team_members",
            where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
        }), documents, { resolveCollection });
        expect(sql).toBe(`EXISTS (SELECT 1 FROM "public"."team_members" "_ex0" WHERE ("_ex0".user_id)::text = (SELECT rebase.uid()))`);
    });

    it("spells authenticated() per call, the form RLS linters recognise", () => {
        expect(policyToPostgres(policy.authenticated()))
            .toBe("(SELECT rebase.uid()) IS NOT NULL AND (SELECT rebase.uid()) NOT IN ('anonymous', 'anon')");
        // Inside a larger row-independent subtree, it is part of that one subquery.
        expect(policyToPostgres(policy.and(policy.authenticated(), policy.rolesOverlap(["editor"]))))
            .toBe("(SELECT (rebase.uid() IS NOT NULL AND rebase.uid() NOT IN ('anonymous', 'anon')) AND (string_to_array(rebase.roles(), ',') && ARRAY['editor']))");
    });
});

describe("sqlToPolicy — reading the initPlan spelling back", () => {
    it("reads a fully understood (SELECT x) back as x", () => {
        expect(sqlToPolicy("(SELECT string_to_array(rebase.roles(), ',') && ARRAY['admin'])"))
            .toEqual(policy.rolesOverlap(["admin"]));
        expect(sqlToPolicy("(SELECT rebase.uid() = 'u1')"))
            .toEqual(policy.compare(policy.authUid(), "eq", policy.literal("u1")));
    });

    it("reads the wrapped uid operand, as the compiler and as Postgres spell it", () => {
        const owner = policy.compare(policy.field("owner_id"), "eq", policy.authUid());
        expect(sqlToPolicy("owner_id = (SELECT rebase.uid())")).toEqual(owner);
        expect(sqlToPolicy("(owner_id = ( SELECT rebase.uid() AS uid))")).toEqual(owner);
    });

    // What `pg_policies` holds for a compiled role rule: Postgres writes the
    // literals' casts back in. `schema introspect` writes it as the rule's
    // `using`, and a junction can only inherit an update rule it understands —
    // read as raw, every `<junction>_default_edge_write_*` policy was left in
    // force with no rule behind it.
    it("reads a role check as Postgres stores it, casts and all", () => {
        expect(sqlToPolicy("( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text]))"))
            .toEqual(policy.rolesOverlap(["admin"]));
        expect(sqlToPolicy("( SELECT (string_to_array(rebase.roles(), ','::text) && ARRAY['admin'::text, 'editor'::text]))"))
            .toEqual(policy.rolesOverlap(["admin", "editor"]));
        expect(sqlToPolicy("(string_to_array(rebase.roles(), ','::text) @> ARRAY['admin'::text])"))
            .toEqual(policy.rolesContain(["admin"]));
        expect(sqlToPolicy("(owner_id = ( SELECT rebase.uid() AS uid)) AND (string_to_array(rebase.roles(), ','::text) && ARRAY['editor'::text])"))
            .toEqual(policy.and(
                policy.compare(policy.field("owner_id"), "eq", policy.authUid()),
                policy.rolesOverlap(["editor"])
            ));
    });

    it("keeps a role array it cannot read element by element as raw", () => {
        // A quote or a comma inside a role name: splitting on "," would invent roles.
        for (const sql of [
            "string_to_array(rebase.roles(), ','::text) && ARRAY['a,b'::text]",
            "string_to_array(rebase.roles(), ','::text) && ARRAY['o''brien'::text]",
            "string_to_array(rebase.roles(), ','::text) && ARRAY[lower('x'::text)]"
        ]) {
            expect(sqlToPolicy(sql)).toEqual(policy.raw(sql));
        }
    });

    it("keeps a subquery it does not fully understand as raw, parens and all", () => {
        // Stripped of its parens this is `SELECT …`, which is not an
        // expression: `USING (SELECT …)` does not parse.
        for (const sql of [
            "(SELECT rebase.uid() IS NULL)",
            "(SELECT a = 'x' FROM t)",
            "(SELECT owner_id FROM t WHERE id = 1)",
            "(SELECT rebase.uid() = 'u1' LIMIT 0)"
        ]) {
            expect(sqlToPolicy(sql)).toEqual(policy.raw(sql));
            expect(policyToPostgres(sqlToPolicy(sql))).toBe(sql);
        }
    });

    it("round-trips every compiled preset to the same expression", () => {
        for (const expr of [
            policy.or(policy.serverContext(), policy.rolesOverlap(["admin"])),
            policy.rolesOverlap(["admin"]),
            policy.compare(policy.authUid(), "eq", policy.field("uid")),
            policy.compare(policy.field("owner_id"), "eq", policy.authUid())
        ]) {
            const once = policyToPostgres(expr);
            expect(policyToPostgres(sqlToPolicy(once))).toBe(once);
        }
    });
});
