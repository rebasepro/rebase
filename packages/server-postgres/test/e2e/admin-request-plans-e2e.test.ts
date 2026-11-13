/**
 * E2E: an admin request plans as the owner's — the admin-only policies'
 * `TO rebase_admin_request USING (true)` companions — against a real Postgres,
 * through the real boot.
 *
 * Every policy expression that is not a constant is a security barrier, and
 * Postgres will not evaluate a non-leakproof operator (`&&`, `~`, jsonb
 * operators) behind one as an index condition. The admin-only policies keep
 * their test, so an admin's `tags && $1` scanned the whole table where the
 * owner's used the GIN index: `rebase.sqlAsAdmin` and `dataAsAdmin` alike.
 * What must hold:
 *
 * - As an admin, a `tags && $1` read uses the GIN index: `sqlAsAdmin`, and
 *   the statement `dataAsAdmin` sends.
 * - A signed-in user stays filtered to their rows; a RESTRICTIVE policy still
 *   binds the admin.
 * - A connection that does not switch roles, though it inherits
 *   `rebase_admin`, sees nothing more than before.
 * - A role other than the admin request roles holding `rebase_admin_request`
 *   makes the next boot drop the companions.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { authContextStatement } from "../../src/security/rls-enforcement.js";
import { resolveRlsSettings } from "../../src/security/rls-settings.js";
import { tablesFromCollections, tablesFrom } from "../helpers/tables.js";

const songs: LegacyCollectionConfig = {
    name: "Songs",
    slug: "songs",
    table: "songs",
    securityRules: [{ name: "owner_select", operation: "select", ownerField: "ownerId" }],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
        tags: { name: "Tags", type: "array", columnType: "text[]", of: { name: "Tag", type: "string" } }
    },
    indexes: [{ on: ["tags"], using: "gin", reason: "songs by tag" }]
};

/** The same, with a RESTRICTIVE rule: a gate every caller passes through, admins included. */
const drafts: LegacyCollectionConfig = {
    name: "Drafts",
    slug: "drafts",
    table: "drafts",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "visible_only", operation: "select", mode: "restrictive", using: "NOT hidden" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
        hidden: { name: "Hidden", type: "boolean" },
        tags: { name: "Tags", type: "array", columnType: "text[]", of: { name: "Tag", type: "string" } }
    }
};

const JWT_SECRET = "admin-request-plans-e2e-secret-that-is-long-enough";
const SERVICE_KEY = "admin-request-plans-e2e-service-key-0123456789abcdef";
const TAG_READ = "SELECT count(*)::int AS n FROM public.songs WHERE tags && $1";

interface PlanNode { "Node Type": string; "Index Name"?: string; Filter?: string; Plans?: PlanNode[] }

const nodesOf = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodesOf)];
const planOf = (rows: Record<string, unknown>[]): PlanNode[] => {
    const value = rows[0]?.["QUERY PLAN"];
    const parsed = (typeof value === "string" ? JSON.parse(value) : value) as { Plan: PlanNode }[];
    return nodesOf(parsed[0].Plan);
};
/** The statements a query config carries: a pipelined batch's, or its own. */
function statementsOf(config: unknown): { text: string; values: unknown[] }[] {
    if (typeof config !== "object" || config === null) return [];
    if ("statements" in config && Array.isArray(config.statements)) return config.statements.flatMap(statementsOf);
    if (!("text" in config) || typeof config.text !== "string") return [];
    return [{ text: config.text, values: "values" in config && Array.isArray(config.values) ? config.values : [] }];
}
const usesTagIndex = (nodes: PlanNode[]) => nodes.some(n => n["Node Type"] === "Bitmap Index Scan" && /tags/.test(n["Index Name"] ?? ""));

describe("admin requests plan as the owner's (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let rebase: OpenedRebase;
    const backends: Array<Awaited<ReturnType<typeof initializeRebaseBackend>>> = [];

    async function boot(): Promise<void> {
        const backend = await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            ...tablesFrom([songs, drafts]),
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            cronPersistence: false
        });
        backends.push(backend);
    }

    /**
     * The plan of `sql` for a request by `uid` holding `roles`, set up by the
     * server's own `authContextStatement` — the request role, or its admin
     * role for an admin — on a connection of its own; `null` for the owner.
     * EXPLAIN is not caller SQL, so it cannot go through `sqlAsAdmin`.
     *
     * With sequential scans off: on a table this size a scan is the cheaper
     * plan for anyone, so what is asked is whether the index is USABLE. Behind
     * a policy barrier Postgres cannot use it for `&&` even then.
     */
    async function planAs(uid: string | null, roles: string[], sql: string, params: unknown[]): Promise<PlanNode[]> {
        const client = new pg.Client({ connectionString: container.connectionString });
        await client.connect();
        try {
            await client.query("BEGIN");
            await client.query("SET LOCAL enable_seqscan = off");
            if (uid !== null) {
                const request = { ...resolveRlsSettings(undefined).request, adminRoleFor: (role: string) => `${role}_admin` };
                const context = authContextStatement({ uid, roles }, request);
                await client.query(context.text, context.values);
            }
            const { rows } = await client.query(`EXPLAIN (FORMAT JSON) ${sql}`, params);
            await client.query("ROLLBACK");
            return planOf(rows);
        } finally {
            await client.end();
        }
    }
    const planAsAdmin = (sql: string, params: unknown[]) => planAs("service", ["admin"], sql, params);

    async function companions(table = "songs"): Promise<string[]> {
        const rows = await rebase.sql("SELECT policyname FROM pg_policies WHERE tablename = $1 AND 'rebase_admin_request' = ANY(roles) ORDER BY 1", { params: [table] });
        return rows.map(row => String(row.policyname));
    }

    beforeAll(async () => {
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        await boot();
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [songs, drafts], tables: tablesFromCollections([songs, drafts]).tables });
        await rebase.sql(`INSERT INTO public.songs (owner_id, tags)
            SELECT 'u' || (g % 37), ARRAY['t' || (g % 500), 'x' || (g % 7)] FROM generate_series(1, 30000) g`);
        await rebase.sql(`INSERT INTO public.drafts (owner_id, hidden, tags)
            SELECT 'u' || (g % 50), g % 10 = 0, ARRAY['t' || (g % 500)] FROM generate_series(1, 5000) g`);
        await rebase.sql("ANALYZE public.songs");
        await rebase.sql("ANALYZE public.drafts");
    }, 240_000);

    afterAll(async () => {
        await rebase?.close();
        for (const backend of backends) await backend.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("writes a companion for each admin-only policy, and the boot made the role the admin request roles' alone", async () => {
        expect(await companions()).toHaveLength(4);
        const [holders] = await rebase.sql(`SELECT ARRAY(SELECT rolname::text FROM pg_roles r
            WHERE pg_has_role(r.oid, 'rebase_admin_request'::regrole, 'USAGE') AND NOT r.rolsuper AND rolname <> 'rebase_admin_request' ORDER BY 1) AS who`);
        expect(holders.who).toEqual(["rebase_user_admin"]);
    });

    it("plans an admin's tags && $1 on the GIN index, as the owner's", async () => {
        const owner = await planAs(null, [], TAG_READ, [["t42"]]);
        const admin = await planAsAdmin(TAG_READ, [["t42"]]);
        expect(usesTagIndex(owner)).toBe(true);
        expect(usesTagIndex(admin)).toBe(true);
    });

    it("plans the statement dataAsAdmin sends on the GIN index", async () => {
        const sent: { text: string; values: unknown[] }[] = [];
        const original = pg.Client.prototype.query;
        Object.defineProperty(pg.Client.prototype, "query", {
            value: function (this: pg.Client, ...args: Parameters<pg.Client["query"]>) {
                const config: unknown = args[0];
                const values: unknown = args[1];
                if (typeof config === "string") sent.push({ text: config, values: Array.isArray(values) ? values : [] });
                else sent.push(...statementsOf(config));
                return Reflect.apply(original, this, args);
            },
            writable: true,
            configurable: true
        });
        try {
            // A count, not a page: a page ordered by id is a primary-key scan for
            // the owner too, and would not tell the two apart.
            const counted = await rebase.dataAsAdmin.songs.count({ where: { tags: ["array-contains-any", ["t42"]] } });
            expect(counted).toBeGreaterThan(0);
        } finally {
            Object.defineProperty(pg.Client.prototype, "query", { value: original, writable: true, configurable: true });
        }
        const read = sent.find(s => /^\s*select\b/i.test(s.text) && /count/i.test(s.text) && /&&/.test(s.text) && !/set_config/i.test(s.text));
        expect(read, sent.map(s => s.text).join("\n")).toBeDefined();
        const nodes = await planAsAdmin(read!.text, read!.values);
        expect(usesTagIndex(nodes)).toBe(true);
        const shape = (plan: PlanNode[]) => plan.map(n => [n["Node Type"], n["Index Name"] ?? null]);
        expect(shape(nodes)).toEqual(shape(await planAs(null, [], read!.text, read!.values)));
    });

    it("keeps a signed-in user filtered to their rows, and the restrictive policy binding the admin", async () => {
        const user = await rebase.withAuth({ uid: "u7", roles: [] });
        const userPlan = await planAs("u7", [], TAG_READ, [["t42"]]);
        expect(userPlan.some(n => /owner_id/.test(n.Filter ?? ""))).toBe(true);
        const [mine] = await user.sql(TAG_READ, { params: [["t7"]] });
        const [owned] = await rebase.sql("SELECT count(*)::int AS n FROM public.songs WHERE tags && $1 AND owner_id = 'u7'", { params: [["t7"]] });
        expect(mine.n).toBe(owned.n);
        expect(mine.n).toBeLessThan((await rebase.sqlAsAdmin(TAG_READ, { params: [["t7"]] }))[0].n as number);

        const DRAFT_READ = "SELECT count(*)::int AS n FROM public.drafts";
        const [asAdmin] = await rebase.sqlAsAdmin(DRAFT_READ);
        const [visible] = await rebase.sql(`${DRAFT_READ} WHERE NOT hidden`);
        const [all] = await rebase.sql(DRAFT_READ);
        expect(await companions("drafts")).toHaveLength(4);
        expect(asAdmin.n).toBe(visible.n);
        expect(Number(asAdmin.n)).toBeLessThan(Number(all.n));
    });

    it("gives a connection that does not switch roles, though it inherits rebase_admin, nothing more", async () => {
        // What a non-switching process on the connection is: a login that
        // inherits rebase_admin, as the boot makes the connection, and is not
        // the table's owner.
        await rebase.sql(`CREATE ROLE outsider LOGIN PASSWORD 'outsider' NOSUPERUSER NOBYPASSRLS;
            GRANT rebase_admin TO outsider WITH INHERIT TRUE; GRANT USAGE ON SCHEMA public TO outsider; GRANT SELECT ON public.songs TO outsider`);
        const url = new URL(container.connectionString);
        url.username = "outsider";
        url.password = "outsider";
        const client = new pg.Client({ connectionString: url.toString() });
        await client.connect();
        try {
            const holds = await client.query("SELECT pg_has_role(current_user, 'rebase_admin_request', 'USAGE') AS holds");
            expect(holds.rows[0].holds).toBe(false);
            await client.query("BEGIN");
            await client.query("SELECT set_config('app.uid', 'u7', true), set_config('app.user_id', 'u7', true), set_config('app.user_roles', '', true)");
            const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM public.songs");
            await client.query("COMMIT");
            const [owned] = await rebase.sql("SELECT count(*)::int AS n FROM public.songs WHERE owner_id = 'u7'");
            expect(rows[0].n).toBe(owned.n);
        } finally {
            await client.end();
        }
    });

    it("drops the companions on the next boot once another role holds rebase_admin_request", async () => {
        await rebase.sql("GRANT rebase_admin_request TO outsider WITH INHERIT TRUE");
        await boot();
        expect(await companions()).toEqual([]);
        expect(usesTagIndex(await planAsAdmin(TAG_READ, [["t42"]]))).toBe(false);

        // Taken back, the boot after writes them again.
        await rebase.sql("REVOKE rebase_admin_request FROM outsider");
        await boot();
        expect(await companions()).toHaveLength(4);
    }, 120_000);
});
