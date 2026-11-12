import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
    SCHEMA_VERSION_HEADER,
    col,
    defineAuthTable,
    defineTable,
    defineView,
    policy,
    rel,
    type BackendBootstrapper,
    type DataDriver,
    type InitializedDriver,
    type PostgresCollectionConfig,
    type TableDescriptor
} from "@rebasepro/types";
import { createRebaseClient } from "@rebasepro/client";
import type { HonoEnv } from "../src/api/types";
import type { RebaseAuthConfig, SchemaTablesOptions } from "../src/backend/options";
import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { BackendCollectionRegistry } from "../src/collections/BackendCollectionRegistry";

/**
 * `GET /api/schema/tables` through the real router of a booted backend: who
 * may ask, what each caller class is served, the public opt-in, introspection
 * mode, the `ETag` / `304` contract the client relies on, and the real
 * `client.schema.tables()` against the real route.
 */

const JWT_SECRET = "schema-tables-route-test-secret-1234567890";

const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        passwordHash: col.text().column("password_hash"),
        roles: col.array(col.text()).notNull().default([])
    },
    rls: "admin-only",
    auth: {
        roles: {
            editor: { name: "Editor", scopes: [] },
            support: { name: "Support", scopes: ["users:read"] },
            auditor: { name: "Auditor", scopes: ["schema:read"] }
        }
    }
});

const authors = defineTable("authors", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        name: col.text().notNull(),
        salary: col.integer().access({ read: ["hr"] }),
        apiToken: col.text().private()
    },
    rls: [{ operation: "select", access: "authenticated" }]
});

const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), name: col.text().notNull() },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        internalNote: col.text().access({ read: ["editor"], write: ["editor"] }),
        authorId: col.uuid().column("author_id"),
        reviewerId: col.uuid().column("reviewer_id")
    },
    relations: {
        author: rel.belongsTo(() => authors, { localKey: "author_id" }),
        reviewer: rel.belongsTo(() => users, { localKey: "reviewer_id", access: { read: ["editor"] } }),
        ghostwriter: rel.belongsTo(() => authors, { localKey: "ghostwriter_id", private: true }),
        tags: rel.manyToMany(() => tags, { through: "posts_tags" })
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["editor"], using: "author_id = rebase.uid()" },
        { operation: "update", condition: policy.or(policy.raw("{title} <> ''"), policy.rolesOverlap(["editor"])) }
    ],
    hooks: { beforeSave: ({ values }) => values }
});

const postStats = defineView("post_stats", {
    query: "SELECT status, count(*)::int AS total FROM posts GROUP BY status",
    materialized: true,
    roles: ["editor"],
    columns: { status: col.text().primaryKey(), total: col.integer() }
});

const TABLES = [users, authors, tags, posts, postStats];

// ── Credentials ──────────────────────────────────────────────────────────────

const KEYS = {
    schemaRead: "rk_schema_read_key_for_tables_route_aaaa",
    postsOnly: "rk_posts_only_key_for_tables_route_bbbb",
    storageOnly: "rk_storage_only_key_for_tables_route_cc",
    adminRoleDataRead: "rk_admin_role_data_key_for_tables_dddd"
} as const;

const KEY_GRANTS: Record<string, { scopes: string[]; roles: string[] }> = {
    [KEYS.schemaRead]: { scopes: ["schema:read"], roles: [] },
    [KEYS.postsOnly]: { scopes: ["data:read:posts"], roles: [] },
    [KEYS.storageOnly]: { scopes: ["storage:read"], roles: [] },
    [KEYS.adminRoleDataRead]: { scopes: ["data:read"], roles: ["admin"] }
};

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

function keyRow(token: string): Record<string, unknown> {
    const grant = KEY_GRANTS[token];
    return {
        id: `key-${token.slice(-4)}`,
        name: "test key",
        kind: "service",
        key_prefix: token.slice(0, 11),
        key_hash: sha256(token),
        scopes: grant.scopes,
        roles: grant.roles,
        owner_uid: null,
        rate_limit: null,
        created_by: "test",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: null
    };
}

function stubDriver(): DataDriver {
    const rows = new Map(Object.keys(KEY_GRANTS).map(token => [sha256(token), keyRow(token)]));
    return fakeDataDriver({
        fetchCollection: async () => [],
        count: async () => 0,
        checkUniqueField: async () => true,
        admin: {
            executeSql: async (sql: string, options?: { params?: unknown[] }) => {
                if (sql.includes("rebase.api_keys") && sql.includes("key_hash = $1")) {
                    const row = rows.get(String(options?.params?.[0]));
                    return row ? [row] : [];
                }
                return [];
            }
        }
    });
}

function bootstrapper(introspected?: PostgresCollectionConfig[]): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: stubDriver(), collections: introspected ?? [], internals: {} };
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    };
}

async function boot(options: {
    auth?: RebaseAuthConfig;
    schemaTables?: SchemaTablesOptions;
    tables?: typeof TABLES;
    introspected?: PostgresCollectionConfig[];
} = {}): Promise<Hono<HonoEnv>> {
    const app = new Hono<HonoEnv>();
    await initializeRebaseBackend({
        app,
        server: createServer(),
        ...(options.introspected ? {} : { tables: options.tables ?? TABLES }),
        bootstrappers: [bootstrapper(options.introspected)],
        cronPersistence: false,
        ...("auth" in options ? (options.auth ? { auth: options.auth } : {}) : { auth: { jwtSecret: JWT_SECRET } }),
        ...(options.schemaTables ? { schemaTables: options.schemaTables } : {})
    });
    return app;
}

const bearer = (token: string, extra: Record<string, string> = {}) => ({ headers: { authorization: `Bearer ${token}`, ...extra } });
const person = (roles: string[], uid = `u-${roles.join("-") || "member"}`) => generateAccessToken(uid, roles);

async function tablesFor(app: Hono<HonoEnv>, init?: RequestInit): Promise<TableDescriptor[]> {
    const response = await app.request("/api/schema/tables", init);
    expect(response.status).toBe(200);
    return await response.json() as TableDescriptor[];
}

const bySlug = (tables: TableDescriptor[], slug: string): TableDescriptor => {
    const table = tables.find(candidate => candidate.slug === slug);
    if (!table) throw new Error(`"${slug}" was not served`);
    return table;
};
const keys = (table: TableDescriptor) => table.columns.map(column => column.key);
const relationNames = (table: TableDescriptor) => table.relations.map(relation => relation.name);

afterEach(() => {
    jest.restoreAllMocks();
});

// ── Who may ask ──────────────────────────────────────────────────────────────

describe("who may ask", () => {
    it("answers 401 to an anonymous caller", async () => {
        const app = await boot();
        expect((await app.request("/api/schema/tables")).status).toBe(401);
        expect((await app.request("/api/schema/tables/posts")).status).toBe(401);
    });

    it("answers 401 to an invalid token rather than reading it as anonymous", async () => {
        const app = await boot({ schemaTables: { public: true } });
        expect((await app.request("/api/schema/tables", bearer("not-a-token"))).status).toBe(401);
    });

    it("does not open with auth.requireAuth: false — a public data plane is not a public schema", async () => {
        const app = await boot({ auth: { jwtSecret: JWT_SECRET, requireAuth: false } });
        expect((await app.request("/api/schema/tables")).status).toBe(401);
    });

    it("answers 404 SCHEMA_UNAVAILABLE when no authentication is configured", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const app = await boot({ auth: undefined });
        const response = await app.request("/api/schema/tables", bearer("anything"));
        expect(response.status).toBe(404);
        expect((await response.json() as { error: { code: string } }).error.code).toBe("SCHEMA_UNAVAILABLE");
        warn.mockRestore();
    });

    it("refuses a credential holding neither schema:read nor a data:* scope with 403", async () => {
        const app = await boot();
        const response = await app.request("/api/schema/tables", bearer(KEYS.storageOnly));
        expect(response.status).toBe(403);
        expect((await response.json() as { error: { code: string } }).error.code).toBe("SCOPE_MISSING");
    });

    it("serves a signed-in user, an API key with schema:read, and a key with only data:read:posts", async () => {
        const app = await boot();
        expect((await app.request("/api/schema/tables", bearer(await person([])))).status).toBe(200);
        expect((await app.request("/api/schema/tables", bearer(KEYS.schemaRead))).status).toBe(200);
        expect((await app.request("/api/schema/tables", bearer(KEYS.postsOnly))).status).toBe(200);
    });
});

// ── What each caller class is served ─────────────────────────────────────────

describe("a signed-in user with no role", () => {
    it("sees every table, row-level security deciding rows", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(await person([])));
        expect(tables.map(table => table.slug)).toEqual(["users", "authors", "tags", "posts", "post_stats"]);
    });

    it("is not served private columns, nor columns or relations whose access.read it fails", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(await person([])));
        expect(keys(bySlug(tables, "authors"))).toEqual(["id", "name"]);
        const postsTable = bySlug(tables, "posts");
        expect(keys(postsTable)).not.toContain("internalNote");
        expect(relationNames(postsTable)).toEqual(["author", "tags"]);
        // A belongsTo's key column follows its own rules; it no longer names
        // the relation it is withheld with.
        const reviewerId = postsTable.columns.find(column => column.key === "reviewerId");
        expect(reviewerId).toBeDefined();
        expect(reviewerId?.foreignKeyOf).toBeUndefined();
        expect(JSON.stringify(postsTable)).not.toContain("ghostwriter");
    });

    it("keeps structured rules, and gets the redacted marker for every rule carrying SQL", async () => {
        const app = await boot();
        const postsTable = bySlug(await tablesFor(app, bearer(await person([]))), "posts");
        expect(postsTable.rls.rules).toEqual([
            { operation: "select", access: "public", condition: { status: "published" } },
            { operations: ["select", "insert", "update"], roles: ["editor"] },
            { operation: "delete", roles: ["editor"], redacted: true },
            { operation: "update", redacted: true }
        ]);
        expect(postsTable.rls.policies).toBeUndefined();
        expect(postsTable.rls.junctions).toBeUndefined();
        expect(JSON.stringify(postsTable)).not.toContain("rebase.uid()");
    });

    it("is served hooks as flags, no view query, no indexes, and no auth labels", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(await person([])));
        expect(bySlug(tables, "posts").hooks).toEqual({ beforeSave: true });
        expect(bySlug(tables, "post_stats").view).toEqual({ materialized: true, roles: ["editor"] });
        const usersTable = bySlug(tables, "users");
        expect(usersTable.auth).toBeDefined();
        expect(usersTable.auth?.roles).toBeUndefined();
        expect(usersTable.auth?.scopes).toBeUndefined();
    });
});

describe("a signed-in user holding the role access.read names", () => {
    it("is served the column and the relation", async () => {
        const app = await boot();
        const postsTable = bySlug(await tablesFor(app, bearer(await person(["editor"]))), "posts");
        expect(keys(postsTable)).toContain("internalNote");
        expect(relationNames(postsTable)).toEqual(["author", "reviewer", "tags"]);
        expect(postsTable.columns.find(column => column.key === "reviewerId")?.foreignKeyOf).toBe("reviewer");
        // Access is kept on what is served: the panel disables inputs from `write`.
        expect(postsTable.columns.find(column => column.key === "internalNote")?.access)
            .toEqual({ read: ["editor"], write: ["editor"] });
        // Still no SQL: reading a column is not reading the authorization model.
        expect(JSON.stringify(postsTable)).not.toContain("rebase.uid()");
    });
});

describe("an administrator", () => {
    it("is served raw SQL, the compiled policies and the junction's, the view query, and the labels", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(await person(["admin"])));
        const postsTable = bySlug(tables, "posts");
        expect(postsTable.rls.rules[2]).toEqual({ operation: "delete", roles: ["editor"], using: "author_id = rebase.uid()" });
        const policies = postsTable.rls.policies ?? [];
        // Every declared rule is compiled, by index, beside the injected admin baseline.
        expect(policies.filter(p => !p.injected).map(p => p.rule).sort()).toEqual([0, 1, 1, 1, 2, 3]);
        expect(policies.some(p => p.injected)).toBe(true);
        expect(postsTable.rls.junctions?.map(junction => junction.table)).toEqual(["posts_tags"]);
        expect(postsTable.rls.junctions?.[0].policies.length).toBeGreaterThan(0);
        expect(bySlug(tables, "post_stats").view?.query).toContain("GROUP BY status");
        expect(Object.keys(bySlug(tables, "users").auth?.roles ?? {})).toEqual(["editor", "support", "auditor"]);
        // Private stays private, for administrators too.
        expect(keys(bySlug(tables, "authors"))).toEqual(["id", "name", "salary"]);
        expect(JSON.stringify(tables)).not.toContain("ghostwriter");
    });

    it("is matched by a role holding schema:read", async () => {
        const app = await boot();
        const postsTable = bySlug(await tablesFor(app, bearer(await person(["auditor"]))), "posts");
        expect(postsTable.rls.policies?.length).toBeGreaterThan(0);
        // schema:read is not a column grant.
        expect(keys(postsTable)).not.toContain("internalNote");
    });

    it("users:read alone grants the auth labels, not the SQL", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(await person(["support"])));
        expect(Object.keys(bySlug(tables, "users").auth?.roles ?? {})).toHaveLength(3);
        expect(bySlug(tables, "posts").rls.policies).toBeUndefined();
    });
});

describe("credentials", () => {
    it("an API key with schema:read sees every table at the privileged level", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(KEYS.schemaRead));
        expect(tables).toHaveLength(5);
        expect(bySlug(tables, "posts").rls.policies?.length).toBeGreaterThan(0);
    });

    it("a key holding only data:read:posts sees only posts, and no relation into a table it is not served", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(KEYS.postsOnly));
        expect(tables.map(table => table.slug)).toEqual(["posts"]);
        const postsTable = tables[0];
        expect(postsTable.relations).toEqual([]);
        expect(keys(postsTable)).toEqual(expect.arrayContaining(["authorId", "reviewerId"]));
        expect(postsTable.columns.some(column => column.foreignKeyOf !== undefined)).toBe(false);
        expect(postsTable.rls.rules[2]).toEqual({ operation: "delete", roles: ["editor"], redacted: true });
        expect((await app.request("/api/schema/tables/authors", bearer(KEYS.postsOnly))).status).toBe(404);
        expect((await app.request("/api/schema/tables/posts", bearer(KEYS.postsOnly))).status).toBe(200);
    });

    it("a key running as admin with data:read reads restricted columns (as REST would), but no SQL", async () => {
        const app = await boot();
        const tables = await tablesFor(app, bearer(KEYS.adminRoleDataRead));
        expect(keys(bySlug(tables, "posts"))).toContain("internalNote");
        expect(bySlug(tables, "posts").rls.policies).toBeUndefined();
    });
});

describe("auth secrets", () => {
    it("never serves password_hash and co. to any caller class", async () => {
        const app = await boot({ schemaTables: { public: true } });
        const callers: (RequestInit | undefined)[] = [
            undefined,
            bearer(await person([])),
            bearer(await person(["editor"])),
            bearer(await person(["admin"])),
            bearer(KEYS.schemaRead),
            bearer(KEYS.postsOnly),
            bearer(KEYS.adminRoleDataRead)
        ];
        for (const caller of callers) {
            const response = await app.request("/api/schema/tables", caller);
            expect(response.status).toBe(200);
            const raw = await response.text();
            expect(raw).not.toMatch(/password_hash|passwordHash/);
        }
    });
});

// ── The public opt-in ────────────────────────────────────────────────────────

describe("schemaTables: { public: true }", () => {
    it("serves anonymous callers only the tables with a public select rule, least-privileged", async () => {
        const info = jest.spyOn(console, "info").mockImplementation(() => {});
        const app = await boot({ schemaTables: { public: true } });
        const tables = await tablesFor(app);
        expect(tables.map(table => table.slug)).toEqual(["posts"]);
        const postsTable = tables[0];
        expect(keys(postsTable)).not.toContain("internalNote");
        // Its targets are not served to this caller, so neither is any relation.
        expect(postsTable.relations).toEqual([]);
        expect(postsTable.rls.rules[2]).toEqual({ operation: "delete", roles: ["editor"], redacted: true });
        expect(postsTable.rls.policies).toBeUndefined();
        info.mockRestore();
    });

    it("leaves signed-in callers exactly as they were", async () => {
        const app = await boot({ schemaTables: { public: true } });
        expect(await tablesFor(app, bearer(await person([])))).toHaveLength(5);
    });
});

// ── Caching ──────────────────────────────────────────────────────────────────

describe("ETag and 304", () => {
    it("tags the body, answers If-None-Match with 304, and says the schema version", async () => {
        const app = await boot();
        const token = await person([]);
        const first = await app.request("/api/schema/tables", bearer(token));
        const etag = first.headers.get("etag");
        expect(etag).toMatch(/^W\/".+-[0-9a-f]{16}"$/);
        expect(first.headers.get("cache-control")).toBe("private, no-cache");
        expect(first.headers.get(SCHEMA_VERSION_HEADER)).toBeTruthy();

        const second = await app.request("/api/schema/tables", bearer(token, { "if-none-match": etag ?? "" }));
        expect(second.status).toBe(304);
        expect(second.headers.get("etag")).toBe(etag);
        expect(await second.text()).toBe("");
    });

    it("is a function of the redaction class: same class, same tag; another class, another tag", async () => {
        const app = await boot();
        const tag = async (init: RequestInit) => (await app.request("/api/schema/tables", init)).headers.get("etag");
        const alice = await tag(bearer(await person([], "alice")));
        const bob = await tag(bearer(await person([], "bob")));
        const editor = await tag(bearer(await person(["editor"])));
        const admin = await tag(bearer(await person(["admin"])));
        expect(alice).toBe(bob);
        expect(new Set([alice, editor, admin]).size).toBe(3);
        // A tag minted for one class does not 304 another.
        const response = await app.request("/api/schema/tables", bearer(await person(["admin"]), { "if-none-match": alice ?? "" }));
        expect(response.status).toBe(200);
    });
});

// ── Introspection mode ───────────────────────────────────────────────────────

/** What the Postgres driver's runtime introspection hands back for two tables (see `buildCollectionsFromSchema`). */
function introspectedCollections(): PostgresCollectionConfig[] {
    const bySlug = new Map<string, PostgresCollectionConfig>();
    const customers: PostgresCollectionConfig = {
        name: "Customers",
        slug: "customers",
        table: "customers",
        schema: "public",
        properties: {
            id: { name: "Id", columnName: "id", type: "string", isId: "uuid" },
            fullName: { name: "Full Name", columnName: "full_name", type: "string", validation: { required: true } }
        }
    };
    const orders: PostgresCollectionConfig = {
        name: "Orders",
        slug: "orders",
        table: "orders",
        schema: "public",
        properties: {
            id: { name: "Id", columnName: "id", type: "number", isId: "increment" },
            total: { name: "Total", columnName: "total", type: "number" },
            customer: {
                name: "Customer",
                type: "relation",
                relation: { kind: "belongsTo", target: () => bySlug.get("customers") ?? customers, localKey: "customer_id" }
            }
        }
    };
    bySlug.set("customers", customers);
    bySlug.set("orders", orders);
    return [customers, orders];
}

describe("introspection mode (no backend/schema)", () => {
    it("serves descriptors built from the introspected tables, with the database-owned posture", async () => {
        const app = await boot({ introspected: introspectedCollections() });
        const tables = await tablesFor(app, bearer(await person(["admin"])));
        expect(tables.map(table => table.slug)).toEqual(["customers", "orders"]);
        expect(keys(bySlug(tables, "customers"))).toEqual(["id", "fullName"]);
        expect(relationNames(bySlug(tables, "orders"))).toEqual(["customer"]);
        // Rebase did not generate these policies and does not read them: the
        // rules say so, and no policies are listed — for an admin either.
        expect(bySlug(tables, "orders").rls).toEqual({
            posture: "rules",
            rules: [{ operations: ["all"], redacted: true }],
            defaultPolicies: false
        });
    });

    it("lets global hooks boot now that every introspected table has a descriptor", async () => {
        const registry = new BackendCollectionRegistry();
        const withRegistry: BackendBootstrapper = {
            ...bootstrapper(introspectedCollections()),
            async initializeDriver(): Promise<InitializedDriver> {
                return { driver: stubDriver(), collections: introspectedCollections(), collectionRegistry: registry, internals: {} };
            }
        };
        await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            bootstrappers: [withRegistry],
            cronPersistence: false,
            auth: { jwtSecret: JWT_SECRET },
            hooks: { beforeSave: ({ values }) => values }
        });
        expect(registry.getGlobalCallbacks()?.beforeSave).toBeDefined();
    });

    it("serves the tables it can describe and names the one it cannot, without failing the boot", async () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const [customers, orders] = introspectedCollections();
        // A function storage path: the table model refuses to describe it.
        const broken: PostgresCollectionConfig = {
            name: "Logs",
            slug: "logs",
            table: "logs",
            schema: "public",
            properties: {
                id: { name: "Id", columnName: "id", type: "string", isId: "uuid" },
                file: { name: "File", columnName: "file", type: "string", storage: { storagePath: () => "logs/" } }
            }
        };
        const app = await boot({ introspected: [customers, orders, broken] });
        const tables = await tablesFor(app, bearer(await person([])));
        expect(tables.map(table => table.slug)).toEqual(["customers", "orders"]);
        expect(warn.mock.calls.flat().join("\n")).toMatch(/"logs" is served, but GET \/api\/schema\/tables does not describe it/);
    });
});

// ── The client against the route ─────────────────────────────────────────────

describe("client.schema.tables() against the real route", () => {
    it("reads the descriptors, revalidates with the ETag, and is refused when signed out", async () => {
        const app = await boot();
        const requests: Response[] = [];
        const fetchThroughApp = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
            const response = await app.request(String(input), init);
            requests.push(response.clone());
            return response;
        };
        const client = createRebaseClient({ baseUrl: "http://backend.test", token: await person(["editor"]), fetch: fetchThroughApp });

        const first = await client.schema.tables();
        expect(first.map(table => table.slug)).toEqual(["users", "authors", "tags", "posts", "post_stats"]);
        const second = await client.schema.tables();
        expect(second).toEqual(first);
        expect(requests.map(response => response.status)).toEqual([200, 304]);

        const signedOut = createRebaseClient({ baseUrl: "http://backend.test", fetch: fetchThroughApp });
        await expect(signedOut.schema.tables()).rejects.toMatchObject({ status: 401 });
    });
});
