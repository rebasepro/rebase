/**
 * The rule forms added with the Postgres-first `rls` — a `PolicyShorthand`
 * condition / check, and `access: "public" | "authenticated"` combined with a
 * condition / check — with tables, rows and callers to run them against.
 *
 * Kept apart from `policy-shapes.ts` on purpose: that corpus feeds the golden
 * corpus (`helpers/plan-corpus.ts`) and is recorded against an older
 * compiler. These shapes have no older compiler; their policies are frozen in
 * `policy-shapes-new.recorded.json` from the release that introduced them,
 * and `policy-new-shapes.test.ts` runs them against Postgres.
 */
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

export const ORG_A = "6f1c2a52-6a0e-4f3c-9a59-2a6f1d0c7a01";
export const ORG_B = "9b2d3e61-1c4f-4a77-8d10-5e3a9c2b4f02";

export const NEW_POLICY_SHAPE_COLLECTIONS: LegacyCollectionConfig[] = [
    // The spec's §4.1 example, verbatim: anonymous reads published rows,
    // an editor reads and writes everything, only an admin deletes.
    {
        name: "Posts", slug: "posts", table: "posts",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            title: { name: "Title", type: "string" },
            status: {
                name: "Status", type: "string",
                enum: [{ id: "draft", label: "Draft" }, { id: "published", label: "Published" }]
            }
        },
        securityRules: [
            { operation: "select", access: "public", condition: { status: "published" } },
            { operations: ["select", "insert", "update"], roles: ["editor"] },
            { operation: "delete", roles: ["admin"] }
        ]
    },
    // `access: "authenticated"` with a shorthand (NULL included), a check-only
    // rule, a check that differs from the condition, and `access: "public"`
    // over a uuid column mapped through `columnName`.
    {
        name: "Reports", slug: "reports", table: "reports",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            state: { name: "State", type: "string" },
            flagged: { name: "Flagged", type: "boolean" },
            orgId: { name: "Org", type: "string", columnName: "org_id" },
            deletedAt: { name: "Deleted", type: "date", columnName: "deleted_at" }
        },
        securityRules: [
            { operation: "select", access: "authenticated", condition: { deletedAt: null } },
            { operation: "insert", access: "authenticated", check: { state: "open", flagged: false } },
            { operation: "update", access: "authenticated", condition: { state: "open" }, check: { state: "open", flagged: false } },
            { operation: "delete", access: "public", condition: { orgId: ORG_A } }
        ]
    },
    // Bare `access: "authenticated"`: any signed-in caller, no row filter.
    {
        name: "Members", slug: "members", table: "members",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            bio: { name: "Bio", type: "string" }
        },
        securityRules: [
            { operations: ["select", "insert"], access: "authenticated" }
        ]
    }
];

export const NEW_POLICY_SHAPE_DDL = `
    CREATE TYPE posts_status AS ENUM ('draft', 'published');
    CREATE TABLE posts (id text PRIMARY KEY, title text, status posts_status);
    CREATE TABLE reports (id text PRIMARY KEY, state text, flagged boolean, org_id uuid, deleted_at timestamptz);
    CREATE TABLE members (id text PRIMARY KEY, bio text);
`;

/** Seeded rows, and rows each caller tries to insert. */
export const NEW_POLICY_SHAPE_ROWS: Record<string, { rows: Record<string, unknown>[]; inserts: Record<string, unknown>[] }> = {
    posts: {
        rows: [
            { id: "p1", title: "live", status: "published" },
            { id: "p2", title: "wip", status: "draft" }
        ],
        inserts: [{ id: "pn", title: "new", status: "draft" }]
    },
    reports: {
        rows: [
            { id: "r1", state: "open", flagged: false, org_id: ORG_A, deleted_at: null },
            { id: "r2", state: "closed", flagged: true, org_id: ORG_B, deleted_at: null },
            { id: "r3", state: "open", flagged: false, org_id: ORG_A, deleted_at: "2026-01-01T00:00:00Z" }
        ],
        inserts: [
            { id: "rn1", state: "open", flagged: false, org_id: ORG_B, deleted_at: null },
            { id: "rn2", state: "open", flagged: true, org_id: ORG_B, deleted_at: null }
        ]
    },
    members: {
        rows: [{ id: "m1", bio: "a" }, { id: "m2", bio: "b" }],
        inserts: [{ id: "mn", bio: "n" }]
    }
};

/** One caller: `null` is the server context (no identity GUCs at all). */
export interface NewPolicyShapeCaller {
    name: string;
    auth: { uid: string; roles: string[] } | null;
}

export const NEW_POLICY_SHAPE_CALLERS: NewPolicyShapeCaller[] = [
    { name: "anonymous", auth: { uid: "", roles: [] } },
    { name: "alice", auth: { uid: "alice", roles: [] } },
    { name: "bob (editor)", auth: { uid: "bob", roles: ["editor"] } },
    { name: "dave (admin)", auth: { uid: "dave", roles: ["admin"] } }
];
