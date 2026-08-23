/**
 * BaaS mode, end to end, against a real Postgres.
 *
 * Every other test in this repo checks a piece of this with the database
 * mocked. The claim is bigger than any piece: point Rebase at a database you
 * already have, declare nothing, and get an API. This is the only thing that
 * makes the whole claim and checks it — no collection files, no generated
 * schema, one connection string.
 *
 * A script rather than a jest suite, for two reasons that are not going away:
 * booting the backend pulls in modules that use `import.meta`, and the unit
 * runners here are CJS; and it needs Docker, which the default test run must
 * not. Run it with `pnpm smoke:baas`.
 */
import { Hono } from "hono";
import { createServer, Server } from "http";
import { getRequestListener } from "@hono/node-server";
import { execFileSync } from "child_process";
import crypto from "crypto";
import pg from "pg";

import { initializeRebaseBackend, logger } from "@rebasepro/server";
import { createPostgresAdapter, createPostgresDatabaseConnection } from "../src/index";

const docker = (...args: string[]): string =>
    execFileSync("docker", args, { encoding: "utf8" });

/**
 * Three tables covering what a row can be keyed on, plus one the security
 * model must refuse to serve.
 */
const SEED = `
    CREATE TABLE products (
        id serial PRIMARY KEY,
        name text NOT NULL,
        price integer
    );

    -- Keyed on a text column that is not called 'id'.
    CREATE TABLE sku_items (
        sku text PRIMARY KEY,
        label text
    );

    -- Composite key.
    CREATE TABLE memberships (
        tenant_id integer NOT NULL,
        user_id integer NOT NULL,
        role text,
        PRIMARY KEY (tenant_id, user_id)
    );

    -- A foreign key: the case where a write's response used to grow a
    -- relation object no read ever served.
    CREATE TABLE orders (
        id serial PRIMARY KEY,
        product_id integer REFERENCES products(id),
        quantity integer NOT NULL
    );

    -- No RLS: must not be served at all.
    CREATE TABLE secrets (
        id serial PRIMARY KEY,
        value text
    );

    ALTER TABLE products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sku_items ENABLE ROW LEVEL SECURITY;
    ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
    ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

    CREATE POLICY products_all ON products FOR ALL TO public USING (true) WITH CHECK (true);
    CREATE POLICY sku_items_all ON sku_items FOR ALL TO public USING (true) WITH CHECK (true);
    CREATE POLICY memberships_all ON memberships FOR ALL TO public USING (true) WITH CHECK (true);
    CREATE POLICY orders_all ON orders FOR ALL TO public USING (true) WITH CHECK (true);

    INSERT INTO products (name, price) VALUES ('Camera', 299);
    INSERT INTO sku_items (sku, label) VALUES ('ABC-1', 'Widget');
    INSERT INTO memberships (tenant_id, user_id, role) VALUES (1, 2, 'admin'), (1, 3, 'viewer');
`;

// The server enforces a minimum length on this, correctly — it is a bearer
// credential that bypasses RLS.
const SERVICE_KEY = "smoke-service-key-that-is-at-least-32-characters-long";

// ── a test harness small enough to read ──────────────────────────────────────
const results: { name: string; error?: string }[] = [];
let currentSuite = "";

async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
    try {
        await fn();
        results.push({ name });
        console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    } catch (error) {
        const message = (error as Error)?.message ?? String(error);
        results.push({ name, error: message });
        console.log(`  \x1b[31m✕\x1b[0m ${name}\n      ${message.split("\n")[0]}`);
    }
}

function expectEqual(actual: unknown, expected: unknown, what: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

function expectTrue(condition: boolean, what: string): void {
    if (!condition) throw new Error(what);
}

async function main(): Promise<void> {
    const containerName = `rebase-baas-smoke-${crypto.randomUUID().slice(0, 8)}`;
    let server: Server | undefined;
    const bootLog: string[] = [];

    const cleanup = () => {
        try { server?.close(); } catch { /* already down */ }
        try { docker("rm", "-f", containerName); } catch { /* already gone */ }
    };
    process.on("exit", cleanup);
    process.on("SIGINT", () => { cleanup(); process.exit(130); });

    try {
        console.log(`\nStarting postgres (${containerName})…`);
        docker(
            "run", "--name", containerName,
            "-e", "POSTGRES_DB=rebase",
            "-e", "POSTGRES_USER=rebase",
            "-e", "POSTGRES_PASSWORD=rebase",
            "-p", "5432", "-d", "postgres:18-alpine"
        );

        const portOutput = docker("port", containerName, "5432");
        const port = parseInt(portOutput.match(/:(\d+)\s*$/m)![1], 10);
        const connectionString = `postgresql://rebase:rebase@localhost:${port}/rebase?sslmode=disable`;

        // Wait by connecting the way the server will, from the host. Not
        // `pg_isready` inside the container: postgres's entrypoint runs a
        // temporary server on a unix socket to do the initdb work and only then
        // restarts listening on TCP, so `pg_isready` says yes while the
        // published port still hangs up on you.
        let seed: pg.Client | undefined;
        for (let i = 0; i < 60; i++) {
            const candidate = new pg.Client({ connectionString });
            try {
                await candidate.connect();
                await candidate.query("SELECT 1");
                seed = candidate;
                break;
            } catch {
                await candidate.end().catch(() => undefined);
                await new Promise(r => setTimeout(r, 500));
            }
        }
        if (!seed) throw new Error("postgres never accepted a connection from the host");

        await seed.query(SEED);
        await seed.end();
        console.log("Seeded. Booting Rebase in BaaS mode…\n");

        // What BaaS refuses to serve, and why, is only ever said at boot.
        for (const level of ["info", "warn"] as const) {
            const original = logger[level].bind(logger);
            (logger as unknown as Record<string, unknown>)[level] = (...args: unknown[]) => {
                bootLog.push(args.map(String).join(" "));
                return original(...(args as [string]));
            };
        }

        const app = new Hono();
        server = createServer(getRequestListener(app.fetch));
        await new Promise<void>(resolve => server!.listen(0, resolve));
        const baseUrl = `http://localhost:${(server.address() as { port: number }).port}`;

        const { db } = createPostgresDatabaseConnection(connectionString);
        await initializeRebaseBackend({
            // The whole point: no collections, no collectionsDir, no schema.
            server,
            app: app as never,
            database: createPostgresAdapter({ connection: db, connectionString }),
            auth: {
                jwtSecret: "smoke-jwt-secret-that-is-long-enough-for-hs256",
                serviceKey: SERVICE_KEY
            }
        } as never);

        const api = (path: string, init?: RequestInit) =>
            fetch(`${baseUrl}/api/data${path}`, {
                ...init,
                headers: {
                    "content-type": "application/json",
                    Authorization: `Bearer ${SERVICE_KEY}`,
                    ...(init?.headers ?? {})
                }
            });

        currentSuite = "rows are the table's columns";
        console.log(`\n${currentSuite}`);

        await check("serves a table it was never told about", async () => {
            const res = await api("/products");
            expectTrue(res.status === 200, `expected 200, got ${res.status}`);
            const body = await res.json() as { data: Record<string, unknown>[] };
            expectEqual(body.data[0].name, "Camera", "products[0].name");
        });

        await check("serves a `sku` key as `sku`, and invents no `id`", async () => {
            const body = await (await api("/sku_items")).json() as { data: Record<string, unknown>[] };
            expectEqual(body.data[0], { sku: "ABC-1", label: "Widget" }, "sku_items[0]");
        });

        await check("keeps an integer key an integer", async () => {
            const body = await (await api("/products")).json() as { data: { id: unknown }[] };
            expectTrue(typeof body.data[0].id === "number", `id was ${typeof body.data[0].id}, not number`);
        });

        await check("serves both columns of a composite key, and no joined token", async () => {
            const body = await (await api("/memberships")).json() as { data: Record<string, unknown>[] };
            expectTrue(typeof body.data[0].tenant_id === "number", "tenant_id missing or not a number");
            expectTrue(!JSON.stringify(body.data).includes(":::"), "a ::: token reached the wire");
        });

        currentSuite = "writes";
        console.log(`\n${currentSuite}`);

        await check("round-trips a `sku`-keyed row: create, read, update, delete", async () => {
            const created = await api("/sku_items", {
                method: "POST",
                body: JSON.stringify({ sku: "XYZ-9", label: "Gadget" })
            });
            expectTrue(created.status === 201, `create: expected 201, got ${created.status} ${await created.text()}`);

            const read = await api("/sku_items/XYZ-9");
            expectTrue(read.status === 200, `read: expected 200, got ${read.status}`);
            expectEqual((await read.json() as { label: string }).label, "Gadget", "label");

            const updated = await api("/sku_items/XYZ-9", {
                method: "PATCH",
                body: JSON.stringify({ label: "Gadget v2" })
            });
            expectTrue(updated.status === 200, `update: expected 200, got ${updated.status} ${await updated.text()}`);

            const beforeDelete = await api("/sku_items/XYZ-9");
            expectTrue(beforeDelete.status === 200, `row vanished after update: GET gave ${beforeDelete.status}`);

            const deleted = await api("/sku_items/XYZ-9", { method: "DELETE" });
            expectTrue(deleted.status < 300, `delete: got ${deleted.status} ${await deleted.text()}`);
            expectTrue((await api("/sku_items/XYZ-9")).status === 404, "row still readable after delete");
        });

        await check("addresses a composite-keyed row by its joined key", async () => {
            const res = await api(`/memberships/${encodeURIComponent("1:::2")}`);
            expectTrue(res.status === 200, `expected 200, got ${res.status}`);
            expectEqual((await res.json() as { role: string }).role, "admin", "role");
        });

        await check("a create's response is the read that follows it, FK included", async () => {
            // The same resource used to have two shapes: POST answered with the
            // admin view-model row (relation refs, normalized ids) while GET
            // served raw columns. Client arithmetic and equality both broke on
            // the first refresh.
            const created = await api("/orders", {
                method: "POST",
                body: JSON.stringify({ product_id: 1, quantity: 2 })
            });
            const createdText = await created.text();
            expectTrue(created.status === 201, `create: expected 201, got ${created.status} ${createdText}`);
            const createdBody = JSON.parse(createdText) as Record<string, unknown>;

            expectTrue(createdBody.product_id === 1, `product_id was ${JSON.stringify(createdBody.product_id)}, not 1`);
            expectTrue(!("product" in createdBody) && !JSON.stringify(createdBody).includes("__type"),
                `a relation object reached the create response: ${JSON.stringify(createdBody)}`);

            const read = await api(`/orders/${createdBody.id}`);
            expectTrue(read.status === 200, `read: expected 200, got ${read.status}`);
            expectEqual(createdBody, await read.json(), "create response vs subsequent GET");
        });

        await check("rejects a write naming a column the table does not have", async () => {
            const res = await api("/sku_items", {
                method: "POST",
                body: JSON.stringify({ sku: "BAD-1", labell: "typo" })
            });
            expectTrue(res.status === 400, `expected 400, got ${res.status}`);
        });

        currentSuite = "the database is the authorization model";
        console.log(`\n${currentSuite}`);

        await check("does not serve a table with no row-level security", async () => {
            // Serving it would hand every row to every caller.
            const res = await api("/secrets");
            expectTrue(res.status === 404, `expected 404, got ${res.status}`);
        });

        await check("names the unprotected table at boot, with the SQL to fix it", async () => {
            const said = bootLog.join("\n");
            expectTrue(said.includes("secrets"), "boot never mentioned `secrets`");
            expectTrue(/ENABLE ROW LEVEL SECURITY/i.test(said), "boot did not say how to protect it");
        });
    } finally {
        cleanup();
    }

    const failed = results.filter(r => r.error);
    console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
    if (failed.length > 0) {
        for (const f of failed) console.log(`  ✕ ${f.name}\n      ${f.error}`);
    }

    // Exit explicitly. A booted backend holds the pg pool, the CDC LISTEN
    // client and the http server open, so returning from here just hangs —
    // which is correct for a server and useless for a script.
    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error("\nSmoke run failed to complete:\n", error);
    process.exit(1);
});
