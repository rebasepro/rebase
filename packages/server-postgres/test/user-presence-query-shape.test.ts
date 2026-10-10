/**
 * "Is there any user?" reads ids, it does not count and sort the table.
 *
 * `GET /auth/config` (anonymous, every admin-panel load and login screen),
 * every closed `POST /auth/register` and every sign-up asked it through
 * `listUsersPaginated({ limit: 1 | 2 })`: a `count(*)` and a
 * `SELECT * … ORDER BY array_length(roles, 1)` over every user row. Measured at
 * 100k users that was 27.6 ms per anonymous request, linear in the table, where
 * `SELECT id … LIMIT 1` is 0.15 ms.
 *
 * Real driver, real SQL (PGlite): the statements are what the database is sent.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Hono } from "hono";
import { createBuiltinAuthAdapter } from "@rebasepro/server";
import { PostgresAuthRepository } from "../src/auth/services";

let pglite: PGlite;
let statements: string[];
let repo: PostgresAuthRepository;

beforeEach(async () => {
    pglite = new PGlite();
    await pglite.waitReady;
    await pglite.exec(`
        CREATE SCHEMA rebase;
        CREATE TABLE rebase.users (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            email text NOT NULL UNIQUE,
            password_hash text,
            display_name text,
            roles text[] NOT NULL DEFAULT '{}',
            created_at timestamp NOT NULL DEFAULT now(),
            updated_at timestamp NOT NULL DEFAULT now()
        );
    `);
    statements = [];
    const db = drizzle(pglite, { logger: { logQuery: (query: string) => { statements.push(query); } } });
    repo = new PostgresAuthRepository(db as unknown as ConstructorParameters<typeof PostgresAuthRepository>[0]);
});

afterEach(async () => {
    await pglite.close();
});

const seed = (n: number) => pglite.exec(Array.from({ length: n }, (_, i) =>
    `INSERT INTO rebase.users (email, roles) VALUES ('u${i}@example.test', '{editor}');`).join("\n"));

/** No statement may count or sort the users table to answer a yes/no question. */
const expectCheapPresenceReads = () => {
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
        expect(statement).not.toMatch(/count\s*\(/i);
        expect(statement).not.toMatch(/order\s+by/i);
        expect(statement).toMatch(/limit/i);
    }
};

describe("asking whether the users table is empty", () => {
    it("GET /auth/config reads at most one id", async () => {
        await seed(3);
        const adapter = createBuiltinAuthAdapter({ authRepository: repo });

        const capabilities = await adapter.getCapabilities();

        expect(capabilities.needsSetup).toBe(false);
        expectCheapPresenceReads();
        expect(statements).toHaveLength(1);
    });

    it("still reports an empty table as needing setup outside production", async () => {
        const adapter = createBuiltinAuthAdapter({ authRepository: repo });

        expect((await adapter.getCapabilities()).needsSetup).toBe(true);
        expectCheapPresenceReads();
    });

    it("a refused registration (registration closed, users exist) neither counts nor sorts", async () => {
        await seed(3);
        const adapter = createBuiltinAuthAdapter({ authRepository: repo, allowRegistration: false });
        const app = new Hono();
        app.route("/auth", adapter.createAuthRoutes()!);

        const res = await app.request("/auth/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: "late@example.test", password: "a-sufficiently-long-Passw0rd" })
        });

        expect(res.status).toBe(403);
        expectCheapPresenceReads();
        expect(statements).toHaveLength(1);
    });

    it("answers with the ids the table holds, never more than asked", async () => {
        expect(await repo.firstUserIds(1)).toEqual([]);
        await seed(3);
        const ids = (await pglite.query<{ id: string }>("SELECT id FROM rebase.users")).rows.map(r => r.id);

        const one = await repo.firstUserIds(1);
        const two = await repo.firstUserIds(2);

        expect(one).toHaveLength(1);
        expect(two).toHaveLength(2);
        expect(ids).toEqual(expect.arrayContaining([...one, ...two]));
    });
});
