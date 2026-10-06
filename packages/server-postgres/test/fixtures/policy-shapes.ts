/**
 * A corpus of collections covering every policy shape the compiler emits, with
 * tables, rows and callers to run them against.
 *
 * Used by `policy-shapes-equivalence.test.ts`, which applies two sets of
 * policies for these collections to the same database — the ones a previous
 * release compiled (recorded in `policy-shapes.recorded.json`) and the ones the
 * compiler emits today — and asserts that every caller can read, insert, update
 * and delete exactly the same rows under both.
 *
 * Editing this corpus invalidates the recording: the equivalence test refuses
 * to run on a policy the recording does not hold. Add a shape by adding a new
 * collection AND recording its policies with the compiler that is being
 * replaced, never by re-recording everything with the compiler under test —
 * that would compare the new output with itself.
 */
import { ANONYMOUS_USER_ID, policy, type CollectionConfig } from "@rebasepro/types";

const ORG_A = "6f1c2a52-6a0e-4f3c-9a59-2a6f1d0c7a01";
const ORG_B = "9b2d3e61-1c4f-4a77-8d10-5e3a9c2b4f02";

const tags = {
    name: "Tags", slug: "tags", table: "tags",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        label: { name: "Label", type: "string" }
    },
    securityRules: [
        // A row-independent comparison against the caller, negated.
        { operation: "select", condition: policy.not(policy.compare(policy.authUid(), "eq", policy.literal("blocked-user"))) }
    ]
} as unknown as CollectionConfig;

const memberships = {
    name: "Memberships", slug: "memberships", table: "memberships",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        userId: { name: "User", type: "string", columnName: "user_id" },
        orgId: { name: "Org", type: "string", columnName: "org_id" }
    },
    securityRules: [{ operation: "select", ownerField: "userId" }]
} as unknown as CollectionConfig;

export const POLICY_SHAPE_COLLECTIONS: CollectionConfig[] = [
    // Nothing declared: the injected server-or-admin baseline alone.
    {
        name: "Docs", slug: "docs", table: "docs",
        properties: { id: { name: "ID", type: "string", isId: true }, title: { name: "Title", type: "string" } }
    },
    // Public read, and writes for an application role.
    {
        name: "Articles", slug: "articles", table: "articles",
        properties: { id: { name: "ID", type: "string", isId: true }, title: { name: "Title", type: "string" } },
        securityRules: [
            { operation: "select", access: "public" },
            { operations: ["insert", "update", "delete"], roles: ["editor"] }
        ]
    },
    // Owner rule over every operation.
    {
        name: "Notes", slug: "notes", table: "notes",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
            body: { name: "Body", type: "string" }
        },
        securityRules: [{ operation: "all", ownerField: "ownerId" }]
    },
    // authenticated / registered / restrictive role rule / claims (text and a
    // guarded bigint cast) / rolesContain.
    {
        name: "Secrets", slug: "secrets", table: "secrets",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            level: { name: "Level", type: "number", validation: { integer: true } },
            region: { name: "Region", type: "string" }
        },
        securityRules: [
            { operation: "select", condition: policy.authenticated() },
            { operation: "select", mode: "restrictive", roles: ["auditor"], condition: policy.compare(policy.field("level"), "lte", policy.literal(3)) },
            { operation: "select", condition: policy.compare(policy.field("level"), "lte", policy.authClaim("clearance")) },
            { operation: "insert", condition: policy.registered() },
            { operation: "update", condition: policy.compare(policy.field("region"), "eq", policy.authClaim("region")) },
            { operation: "delete", condition: policy.rolesContain(["admin", "editor"]) }
        ]
    },
    // An auth collection: self read and the restrictive admin write gate, plus
    // an author rule that the gate has to overrule.
    {
        name: "Accounts", slug: "accounts", table: "accounts", auth: true,
        properties: {
            id: { name: "ID", type: "string", isId: true },
            email: { name: "Email", type: "string" }
        },
        securityRules: [{ operation: "update", ownerField: "id" }]
    },
    // Tenancy from a claim, on a uuid column (the guarded cast).
    {
        name: "Projects", slug: "projects", table: "projects",
        tenant: { field: "orgId", from: { claim: "org" } },
        properties: {
            id: { name: "ID", type: "string", isId: true },
            orgId: { name: "Org", type: "string", columnType: "uuid", columnName: "org_id" },
            name: { name: "Name", type: "string" }
        },
        securityRules: [{ operation: "all", condition: policy.authenticated() }]
    },
    memberships,
    // Tenancy from a membership table (EXISTS), with extra bypass roles.
    {
        name: "Tasks", slug: "tasks", table: "tasks",
        tenant: {
            field: "orgId",
            from: { membership: { collection: "memberships", userField: "userId", tenantField: "orgId" } },
            bypassRoles: ["admin", "support"]
        },
        properties: {
            id: { name: "ID", type: "string", isId: true },
            orgId: { name: "Org", type: "string", columnName: "org_id" },
            title: { name: "Title", type: "string" }
        },
        securityRules: [
            { operation: "select", access: "public" },
            { operations: ["insert", "update"], condition: policy.authenticated() }
        ]
    },
    // Author-written membership EXISTS, and a mix of row-independent and
    // row-dependent operands under one OR.
    {
        name: "Boards", slug: "boards", table: "boards",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            orgId: { name: "Org", type: "string", columnName: "org_id" }
        },
        securityRules: [
            {
                operation: "select",
                condition: policy.existsIn({
                    collection: "memberships",
                    where: policy.and(
                        policy.compare(policy.field("orgId"), "eq", policy.outerField("orgId")),
                        policy.compare(policy.field("userId"), "eq", policy.authUid())
                    )
                })
            },
            {
                operation: "update",
                condition: policy.or(
                    policy.rolesOverlap(["support"]),
                    policy.and(
                        policy.not(policy.rolesOverlap(["banned"])),
                        policy.existsIn({
                            collection: "memberships",
                            where: policy.and(
                                policy.compare(policy.field("orgId"), "eq", policy.outerField("orgId")),
                                policy.compare(policy.field("userId"), "eq", policy.authUid())
                            )
                        })
                    )
                )
            }
        ]
    },
    // A many-to-many: the junction's derived policies (baseline, edge read
    // through both endpoints, edge write inherited from the owner rule).
    {
        name: "Posts", slug: "posts", table: "posts",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
            title: { name: "Title", type: "string" }
        },
        relations: [{
            kind: "manyToMany", relationName: "tags", target: () => tags,
            through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
        }],
        securityRules: [
            { operation: "select", access: "public" },
            { operation: "update", ownerField: "ownerId" }
        ]
    },
    tags,
    // Raw SQL, one the parser structures and one it cannot.
    {
        name: "Wiki", slug: "wiki", table: "wiki",
        properties: {
            id: { name: "ID", type: "string", isId: true },
            ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
            visibility: { name: "Visibility", type: "string" },
            title: { name: "Title", type: "string" }
        },
        securityRules: [
            { operation: "select", using: "owner_id = rebase.uid() OR visibility = 'public'" },
            { operation: "insert", withCheck: "length(title) > 3 AND owner_id = rebase.uid()" }
        ]
    },
    // Opted out of the defaults: the server context alone.
    {
        name: "Jobs", slug: "jobs", table: "jobs", disableDefaultPolicies: true,
        properties: { id: { name: "ID", type: "string", isId: true }, payload: { name: "Payload", type: "string" } },
        securityRules: [{ operation: "all", condition: policy.serverContext() }]
    },
    // Row-independent compares, AND of authenticated with a role, a constant
    // folded into an OR, and a restrictive role gate that is constant false.
    {
        name: "Flags", slug: "flags", table: "flags",
        properties: { id: { name: "ID", type: "string", isId: true }, name: { name: "Name", type: "string" } },
        securityRules: [
            { operation: "select", condition: policy.compare(policy.authUid(), "neq", policy.literal(ANONYMOUS_USER_ID)) },
            { operation: "insert", condition: policy.and(policy.authenticated(), policy.rolesOverlap(["editor"])) },
            { operation: "update", condition: policy.or(policy.false(), policy.rolesOverlap(["editor", "support"])) },
            { operation: "delete", mode: "restrictive", roles: ["intern"], condition: policy.false() }
        ]
    }
] as unknown as CollectionConfig[];

/** The tables, created by hand so the corpus does not depend on the planner. */
export const POLICY_SHAPE_DDL = `
    CREATE TABLE docs (id text PRIMARY KEY, title text);
    CREATE TABLE articles (id text PRIMARY KEY, title text);
    CREATE TABLE notes (id text PRIMARY KEY, owner_id text, body text);
    CREATE TABLE secrets (id text PRIMARY KEY, level bigint, region text);
    CREATE TABLE accounts (id text PRIMARY KEY, email text);
    CREATE TABLE projects (id text PRIMARY KEY, org_id uuid, name text);
    CREATE TABLE memberships (id text PRIMARY KEY, user_id text, org_id text);
    CREATE TABLE tasks (id text PRIMARY KEY, org_id text, title text);
    CREATE TABLE boards (id text PRIMARY KEY, org_id text);
    CREATE TABLE posts (id text PRIMARY KEY, owner_id text, title text);
    CREATE TABLE tags (id text PRIMARY KEY, label text);
    CREATE TABLE posts_tags (post_id text, tag_id text, PRIMARY KEY (post_id, tag_id));
    CREATE TABLE wiki (id text PRIMARY KEY, owner_id text, visibility text, title text);
    CREATE TABLE jobs (id text PRIMARY KEY, payload text);
    CREATE TABLE flags (id text PRIMARY KEY, name text);
`;

/**
 * Rows every caller is tested against, and the rows each one tries to insert.
 * Values chosen so that every policy admits some callers and refuses others —
 * a corpus in which everything is denied would pass any comparison.
 */
export const POLICY_SHAPE_ROWS: Record<string, { rows: Record<string, unknown>[]; inserts: Record<string, unknown>[] }> = {
    docs: { rows: [{ id: "d1", title: "a" }], inserts: [{ id: "dn", title: "n" }] },
    articles: { rows: [{ id: "a1", title: "a" }, { id: "a2", title: "b" }], inserts: [{ id: "an", title: "n" }] },
    notes: {
        rows: [{ id: "n1", owner_id: "alice", body: "x" }, { id: "n2", owner_id: "bob", body: "y" }, { id: "n3", owner_id: null, body: "z" }],
        inserts: [{ id: "nn1", owner_id: "alice", body: "n" }, { id: "nn2", owner_id: "bob", body: "n" }]
    },
    secrets: {
        rows: [
            { id: "s1", level: 1, region: "eu" },
            { id: "s2", level: 3, region: "us" },
            { id: "s3", level: 7, region: "eu" },
            { id: "s4", level: null, region: null }
        ],
        inserts: [{ id: "sn", level: 2, region: "eu" }]
    },
    accounts: {
        rows: [{ id: "alice", email: "a@x" }, { id: "bob", email: "b@x" }, { id: "dave", email: "d@x" }],
        inserts: [{ id: "zed", email: "z@x" }, { id: "alice2", email: "a2@x" }]
    },
    projects: {
        rows: [{ id: "p1", org_id: ORG_A, name: "a" }, { id: "p2", org_id: ORG_B, name: "b" }, { id: "p3", org_id: null, name: "c" }],
        inserts: [{ id: "pn1", org_id: ORG_A, name: "n" }, { id: "pn2", org_id: ORG_B, name: "n" }]
    },
    memberships: {
        rows: [
            { id: "m1", user_id: "alice", org_id: "org-a" },
            { id: "m2", user_id: "bob", org_id: "org-b" },
            { id: "m3", user_id: "erin", org_id: "org-a" },
            { id: "m4", user_id: "mallory", org_id: "org-a" }
        ],
        inserts: [{ id: "mn", user_id: "alice", org_id: "org-b" }]
    },
    tasks: {
        rows: [{ id: "t1", org_id: "org-a", title: "a" }, { id: "t2", org_id: "org-b", title: "b" }, { id: "t3", org_id: "org-c", title: "c" }],
        inserts: [{ id: "tn1", org_id: "org-a", title: "n" }, { id: "tn2", org_id: "org-b", title: "n" }]
    },
    boards: {
        rows: [{ id: "b1", org_id: "org-a" }, { id: "b2", org_id: "org-b" }, { id: "b3", org_id: null }],
        inserts: [{ id: "bn", org_id: "org-a" }]
    },
    posts: {
        rows: [{ id: "po1", owner_id: "alice", title: "a" }, { id: "po2", owner_id: "bob", title: "b" }],
        inserts: [{ id: "pon", owner_id: "alice", title: "n" }]
    },
    tags: { rows: [{ id: "tg1", label: "a" }, { id: "tg2", label: "b" }], inserts: [{ id: "tgn", label: "n" }] },
    posts_tags: {
        rows: [{ post_id: "po1", tag_id: "tg1" }, { post_id: "po2", tag_id: "tg2" }],
        inserts: [{ post_id: "po1", tag_id: "tg2" }, { post_id: "po2", tag_id: "tg1" }]
    },
    wiki: {
        rows: [
            { id: "w1", owner_id: "alice", visibility: "private", title: "alpha" },
            { id: "w2", owner_id: "bob", visibility: "public", title: "beta" },
            { id: "w3", owner_id: "bob", visibility: "private", title: "gamma" }
        ],
        inserts: [{ id: "wn1", owner_id: "alice", visibility: "private", title: "long title" }, { id: "wn2", owner_id: "alice", visibility: "private", title: "ab" }]
    },
    jobs: { rows: [{ id: "j1", payload: "x" }], inserts: [{ id: "jn", payload: "n" }] },
    flags: { rows: [{ id: "f1", name: "a" }, { id: "f2", name: "b" }], inserts: [{ id: "fn", name: "n" }] }
};

/** One caller: `null` is the server context (no identity GUCs at all). */
export interface PolicyShapeCaller {
    name: string;
    auth: { uid: string; roles: string[]; isAnonymous?: boolean; claims?: Record<string, unknown> } | null;
}

export const POLICY_SHAPE_CALLERS: PolicyShapeCaller[] = [
    { name: "server", auth: null },
    { name: "anonymous", auth: { uid: "", roles: [] } },
    { name: "guest", auth: { uid: "guest-1", roles: [], isAnonymous: true } },
    { name: "alice", auth: { uid: "alice", roles: [], claims: { org: ORG_A, region: "eu", clearance: "2" } } },
    { name: "bob (editor)", auth: { uid: "bob", roles: ["editor"], claims: { org: ORG_B, region: "us", clearance: "5" } } },
    { name: "carol (auditor)", auth: { uid: "carol", roles: ["auditor"], claims: { clearance: "9" } } },
    { name: "dave (admin)", auth: { uid: "dave", roles: ["admin"] } },
    { name: "erin (support)", auth: { uid: "erin", roles: ["support"], claims: { org: ORG_A } } },
    // Malformed claims: the guarded casts must deny rather than raise.
    { name: "mallory (banned)", auth: { uid: "mallory", roles: ["banned"], claims: { org: "not-a-uuid", clearance: "99999999999999999999" } } },
    { name: "blocked (editor)", auth: { uid: "blocked-user", roles: ["editor"] } },
    { name: "ivan (intern, editor)", auth: { uid: "ivan", roles: ["intern", "editor", "admin"] } }
];
