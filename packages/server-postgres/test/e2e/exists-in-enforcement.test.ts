/**
 * E2E: membership policies (`policy.existsIn`) enforce what they claim to.
 *
 * `existsIn` is the most complex thing `policyToPostgres` emits — a correlated
 * `EXISTS (SELECT 1 FROM <join> "_exN" WHERE …)` where `field` binds to the
 * aliased join table and `outerField` binds to the outer RLS row. Until now it
 * has only ever been checked as a *string*, in `policyToPostgres.test.ts`. A
 * string test cannot see the failure that matters here, because the failure is
 * not a syntax error: it is a correlation that silently collapses.
 *
 * If an `outerField` were emitted unqualified, `m.team_id = team_id` binds both
 * sides to the inner table and becomes `m.team_id = m.team_id` — a tautology.
 * The policy then reads as "documents on a team you belong to" and means
 * "documents, if you belong to any team at all". It compiles, it runs, it
 * returns rows, and nothing anywhere says the check stopped checking. That is
 * the same shape as the unqualified-`id`-in-a-subquery bug this codebase has
 * already been bitten by once.
 *
 * So: compile the policy, install it as a real `CREATE POLICY` on a real table,
 * read as each user through `rebase_user`, and compare the rows Postgres
 * returns against a reference computed in JavaScript from the same fixture.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql as drizzleSql } from "drizzle-orm";
import { policy, type CollectionConfig, type PolicyExpression } from "@rebasepro/types";
import { policyToPostgres } from "@rebasepro/common";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { RLS_BOOTSTRAP_SQL } from "../../src/schema/rls-bootstrap-sql.js";
import { applyAuthContext, ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";

let container: PgContainer;
let pool: pg.Pool;
let admin: pg.Client;

// ── Fixture ──────────────────────────────────────────────────────────
//
// Chosen so that a collapsed correlation is *visible*: u1 belongs to a team,
// and there exist documents on other teams. A tautological subquery would show
// u1 every document; the correct one shows only t1's.

const MEMBERSHIPS = [
    { id: "m1", team_id: "t1", user_id: "u1" },
    { id: "m2", team_id: "t2", user_id: "u2" },
    { id: "m3", team_id: "t3", user_id: "u2" }
];

const DOCUMENTS = [
    { id: "d1", team_id: "t1", title: "one" },
    { id: "d2", team_id: "t2", title: "two" },
    { id: "d3", team_id: "t3", title: "three" },
    { id: "d4", team_id: null, title: "orphan" }
];

/** u3 belongs to nothing — the case a tautology cannot distinguish from u1. */
const USERS = ["u1", "u2", "u3"];

const documentsCollection = {
    slug: "documents", name: "Documents", table: "documents", properties: {}
} as unknown as CollectionConfig;

const teamMembersCollection = {
    slug: "teamMembers", name: "Team members", table: "team_members", properties: {}
} as unknown as CollectionConfig;

const resolveCollection = (slug: string): CollectionConfig | undefined =>
    slug === "teamMembers" ? teamMembersCollection : undefined;

/** "Documents on a team the caller belongs to." */
const MEMBERSHIP_POLICY: PolicyExpression = policy.existsIn({
    collection: "teamMembers",
    where: policy.and(
        policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
        policy.compare(policy.field("user_id"), "eq", policy.authUid())
    )
});

/**
 * The reference: what the policy *says*, computed independently of the SQL.
 * Deliberately naive — it is a restatement of the English sentence above, which
 * is the only thing that makes it a check rather than a second copy of the
 * compiler.
 */
function expectedVisible(uid: string): string[] {
    const myTeams = new Set(MEMBERSHIPS.filter(m => m.user_id === uid).map(m => m.team_id));
    return DOCUMENTS.filter(d => d.team_id !== null && myTeams.has(d.team_id)).map(d => d.id).sort();
}

/** Read `documents` as `uid` would, through the RLS-bound role. */
async function visibleTo(uid: string): Promise<string[]> {
    const db = drizzle(pool);
    return db.transaction(async (tx) => {
        await tx.execute(drizzleSql.raw(`SET LOCAL ROLE ${REBASE_USER_ROLE}`));
        await applyAuthContext(tx, { uid, roles: [] });
        const result = await tx.execute(drizzleSql.raw("SELECT id FROM public.documents ORDER BY id"));
        return (result as unknown as { rows: { id: string }[] }).rows.map(r => r.id).sort();
    });
}

async function installPolicy(name: string, expr: PolicyExpression): Promise<string> {
    const compiled = policyToPostgres(expr, documentsCollection, { resolveCollection });
    await admin.query(`DROP POLICY IF EXISTS ${name} ON public.documents`);
    await admin.query(`CREATE POLICY ${name} ON public.documents FOR SELECT TO public USING (${compiled})`);
    return compiled;
}

beforeAll(async () => {
    container = await startPgContainer();
    admin = new pg.Client({ connectionString: container.connectionString });
    await admin.connect();
    await admin.query(RLS_BOOTSTRAP_SQL);

    await admin.query(`
        CREATE TABLE public.team_members (
            id text PRIMARY KEY, team_id text, user_id text
        );
        CREATE TABLE public.documents (
            id text PRIMARY KEY, team_id text, title text
        );
        ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    `);
    for (const m of MEMBERSHIPS) {
        await admin.query("INSERT INTO public.team_members VALUES ($1,$2,$3)", [m.id, m.team_id, m.user_id]);
    }
    for (const d of DOCUMENTS) {
        await admin.query("INSERT INTO public.documents VALUES ($1,$2,$3)", [d.id, d.team_id, d.title]);
    }

    pool = new pg.Pool({ connectionString: container.connectionString });
    const runSql = async (text: string) => (await pool.query(text)).rows as Record<string, unknown>[];
    await ensureAppRole(runSql, ["public", "rebase"]);
    // The join table is read *inside* the policy, by the same role, so it needs
    // its own grant — a membership policy that cannot see the membership table
    // denies everything, which is fail-closed but not what anyone wrote.
    await admin.query(`GRANT SELECT ON public.team_members, public.documents TO ${REBASE_USER_ROLE}`);
}, 180_000);

afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.end().catch(() => {});
    if (container) await stopPgContainer(container.containerName);
}, 30_000);

describe("existsIn enforcement", () => {

    it("compiles to a correlated subquery that qualifies the outer row", async () => {
        const compiled = await installPolicy("docs_membership", MEMBERSHIP_POLICY);
        // The outer reference must be table-qualified. A bare `team_id` here is
        // the collapse this whole file exists to detect.
        expect(compiled).toContain('"public"."documents".team_id');
        expect(compiled).toMatch(/EXISTS \(SELECT 1 FROM "public"\."team_members" "_ex\d+"/);
    });

    it("shows each user exactly the documents their memberships grant", async () => {
        await installPolicy("docs_membership", MEMBERSHIP_POLICY);
        for (const uid of USERS) {
            expect({ uid, visible: await visibleTo(uid) })
                .toEqual({ uid, visible: expectedVisible(uid) });
        }
    });

    /**
     * The discriminating assertions, spelled out separately from the loop above
     * so a failure says which property broke rather than which user it broke
     * for. Each of these is false under a collapsed correlation.
     */
    it("does not leak another team's documents to a member of some team", async () => {
        await installPolicy("docs_membership", MEMBERSHIP_POLICY);
        expect(await visibleTo("u1")).toEqual(["d1"]);        // not d2, not d3
        expect(await visibleTo("u2")).toEqual(["d2", "d3"]);  // not d1
    });

    it("shows nothing to a user who belongs to no team", async () => {
        await installPolicy("docs_membership", MEMBERSHIP_POLICY);
        expect(await visibleTo("u3")).toEqual([]);
    });

    it("never shows a row whose correlating column is NULL", async () => {
        await installPolicy("docs_membership", MEMBERSHIP_POLICY);
        for (const uid of USERS) {
            expect(await visibleTo(uid)).not.toContain("d4");
        }
    });

    /**
     * A tautological subquery — what the bug would produce — is installed
     * deliberately and shown to behave differently. Without this, every
     * assertion above would also pass against a compiler that had regressed in
     * some *other* way that happened to deny rows, and the suite would be
     * measuring the fixture rather than the correlation.
     */
    it("is distinguishable from the collapsed correlation it must not be", async () => {
        const collapsed = policy.existsIn({
            collection: "teamMembers",
            where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
        });
        await installPolicy("docs_membership", collapsed);
        // "any member of any team sees everything" — including the orphan row.
        expect(await visibleTo("u1")).toEqual(["d1", "d2", "d3", "d4"]);
        expect(await visibleTo("u3")).toEqual([]);

        // …and the real policy does not behave that way.
        await installPolicy("docs_membership", MEMBERSHIP_POLICY);
        expect(await visibleTo("u1")).toEqual(["d1"]);
    });

    /**
     * Two subqueries in one expression must not share an alias, or the inner
     * one shadows the outer and the correlation binds to the wrong relation.
     * Checked by execution rather than by reading the SQL, because a shadowed
     * alias is still valid SQL.
     */
    it("keeps sibling subqueries independent", async () => {
        const twoHops = policy.and(
            MEMBERSHIP_POLICY,
            policy.existsIn({
                collection: "teamMembers",
                where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
            })
        );
        const compiled = await installPolicy("docs_membership", twoHops);
        const aliases = [...compiled.matchAll(/FROM "public"\."team_members" "(_ex\d+)"/g)].map(m => m[1]);
        expect(aliases).toHaveLength(2);
        expect(new Set(aliases).size).toBe(2);

        // The `and` of "my team's docs" and "I am in some team" is just the
        // first for anyone who is in a team, and empty for anyone who is not.
        for (const uid of USERS) {
            expect({ uid, visible: await visibleTo(uid) })
                .toEqual({ uid, visible: expectedVisible(uid) });
        }
    });

    /**
     * The negation. `not(existsIn(...))` is how "documents *outside* your teams"
     * is written, and it is the form where a collapsed correlation inverts from
     * leaking everything to hiding everything.
     */
    it("enforces the complement correctly under negation", async () => {
        await installPolicy("docs_membership", policy.not(MEMBERSHIP_POLICY));
        for (const uid of USERS) {
            const mine = new Set(expectedVisible(uid));
            const complement = DOCUMENTS.map(d => d.id).filter(id => !mine.has(id)).sort();
            expect({ uid, visible: await visibleTo(uid) }).toEqual({ uid, visible: complement });
        }
    });
});
