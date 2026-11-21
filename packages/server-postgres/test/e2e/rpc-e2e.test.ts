/**
 * E2E: `defineRpc` — a SQL function served at `POST /api/rpc/<name>`, through
 * the real boot, auth middleware and Postgres.
 *
 * What is pinned:
 *
 * - a call runs as the caller: an anonymous caller as the anonymous identity,
 *   a signed-in one as themselves, so a SECURITY INVOKER function sees the
 *   rows the tables' policies give them and a SECURITY DEFINER one runs as its
 *   owner (the Supabase "public proposal by token" pattern);
 * - `access: "authenticated"` refuses an anonymous caller with 401;
 * - arguments are validated (400 naming the field) and bound, never
 *   interpolated, and an absent one takes the function's DEFAULT;
 * - the answer's shape follows the function: an array for SETOF, the row or
 *   the value otherwise, timestamptz as RFC 3339 and bigint as a number;
 * - an RPC is read-only unless declared `write: true`;
 * - `RAISE EXCEPTION` answers 400 with its message;
 * - a function nobody declared is 404, even though it exists.
 *
 * Requires Docker.
 */
import { createServer } from "node:http";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Hono } from "hono";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { defineRpc, json, initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";
import { tablesFrom } from "../helpers/tables.js";

const JWT_SECRET = "rpc-e2e-secret-that-is-long-enough-0123456789abcdef";
const SERVICE_KEY = "rpc-e2e-service-key-0123456789abcdef";

const proposals: LegacyCollectionConfig = {
    name: "Proposals",
    slug: "proposals",
    table: "proposals",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        token: { name: "Token", type: "string" },
        title: { name: "Title", type: "string" }
    }
};

const rpc = [
    defineRpc("my_proposals", { access: "public", args: { prefix: json.string() } }),
    defineRpc("get_public_proposal", { access: "public", args: { token: json.string().required() } }),
    defineRpc("count_mine", { access: "authenticated" }),
    defineRpc("stamp", { access: "public", args: { at: json.date().required() } }),
    defineRpc("add_proposal", { access: "authenticated", write: true, args: { title: json.string().required() } }),
    defineRpc("add_proposal_read_only", { access: "authenticated", args: { title: json.string().required() } }),
    defineRpc("refuse", { access: "public", args: { reason: json.string().required() } })
];

describe("defineRpc against Postgres (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;
    const quiet: Array<{ mockRestore(): void }> = [];
    let ada = "";
    let bob = "";
    let adaBearer = "";
    let bobBearer = "";

    async function call(name: string, body?: unknown, authorization?: string) {
        const res = await app.request(`/api/rpc/${name}`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        });
        return { status: res.status, body: await res.json() as unknown };
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined),
            vi.spyOn(console, "warn").mockImplementation(() => undefined)
        );
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            ...tablesFrom([proposals]),
            rpc,
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            cronPersistence: false
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        ada = (await repo.createUser({ email: "ada@rpc.test", passwordHash: "x", emailVerified: true })).id;
        bob = (await repo.createUser({ email: "bob@rpc.test", passwordHash: "x", emailVerified: true })).id;
        adaBearer = `Bearer ${await generateAccessToken(ada, ["user"])}`;
        bobBearer = `Bearer ${await generateAccessToken(bob, ["user"])}`;

        // As the owner, the way a migration or `backend/sql` would.
        await connection.pool.query(
            "INSERT INTO public.proposals (owner_id, token, title) VALUES ($1, 'tok-ada-1', 'Rome'), ($1, 'tok-ada-2', 'Lisbon'), ($2, 'tok-bob-1', 'Oslo')",
            [ada, bob]
        );
        await connection.pool.query(`
            CREATE FUNCTION public.my_proposals(prefix text DEFAULT '')
            RETURNS SETOF public.proposals LANGUAGE sql STABLE
            AS $$ SELECT * FROM public.proposals WHERE title LIKE prefix || '%' ORDER BY title $$;

            CREATE FUNCTION public.get_public_proposal(token text)
            RETURNS public.proposals LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
            AS $$ SELECT * FROM public.proposals p WHERE p.token = get_public_proposal.token $$;

            CREATE FUNCTION public.count_mine() RETURNS bigint LANGUAGE sql STABLE
            AS $$ SELECT count(*) FROM public.proposals $$;

            CREATE FUNCTION public.stamp(at timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE
            AS $$ SELECT at + interval '1 day' $$;

            CREATE FUNCTION public.add_proposal(title text) RETURNS public.proposals LANGUAGE sql
            AS $$ INSERT INTO public.proposals (owner_id, token, title) VALUES (rebase.uid(), md5(title), title) RETURNING * $$;

            CREATE FUNCTION public.add_proposal_read_only(title text) RETURNS public.proposals LANGUAGE sql
            AS $$ INSERT INTO public.proposals (owner_id, token, title) VALUES (rebase.uid(), md5(title), title) RETURNING * $$;

            CREATE FUNCTION public.refuse(reason text) RETURNS void LANGUAGE plpgsql
            AS $$ BEGIN RAISE EXCEPTION '%', reason USING HINT = 'ask the agency'; END $$;

            CREATE FUNCTION public.secret_count() RETURNS bigint LANGUAGE sql SECURITY DEFINER
            AS $$ SELECT count(*) FROM public.proposals $$;
        `);
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("runs a SECURITY INVOKER function under the caller's row-level security", async () => {
        const anonymous = await call("my_proposals", {});
        expect(anonymous).toEqual({ status: 200, body: [] });

        const mine = await call("my_proposals", {}, adaBearer);
        expect(mine.status).toBe(200);
        expect((mine.body as Array<{ title: string }>).map(row => row.title)).toEqual(["Lisbon", "Rome"]);

        const filtered = await call("my_proposals", { prefix: "R" }, adaBearer);
        expect((filtered.body as Array<{ title: string; owner_id: string }>)).toEqual([
            expect.objectContaining({ title: "Rome", owner_id: ada })
        ]);
        expect(((await call("my_proposals", {}, bobBearer)).body as Array<{ title: string }>).map(row => row.title)).toEqual(["Oslo"]);
    });

    it("runs a SECURITY DEFINER function as its owner, for an anonymous caller too", async () => {
        const found = await call("get_public_proposal", { token: "tok-bob-1" });
        expect(found.status).toBe(200);
        expect(found.body).toEqual(expect.objectContaining({ title: "Oslo", owner_id: bob }));
        expect(await call("get_public_proposal", { token: "nope" })).toEqual({ status: 200, body: null });
    });

    it("binds the arguments: a value that reads as SQL is only a value", async () => {
        const injected = await call("get_public_proposal", { token: "x' OR '1'='1" });
        expect(injected).toEqual({ status: 200, body: null });
        const [{ n }] = (await connection.pool.query("SELECT count(*)::int AS n FROM public.proposals")).rows;
        expect(n).toBe(3);
    });

    it("refuses an anonymous caller of an authenticated RPC with 401, and answers a scalar as its value", async () => {
        expect((await call("count_mine")).status).toBe(401);
        expect(await call("count_mine", undefined, adaBearer)).toEqual({ status: 200, body: 2 });
    });

    it("validates the arguments before the database, naming the field", async () => {
        const res = await call("get_public_proposal", { tokn: "x" });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
            error: {
                code: "VALIDATION_CONSTRAINT",
                details: { violations: [expect.objectContaining({ field: "tokn" }), expect.objectContaining({ field: "token", code: "required" })] }
            }
        });
    });

    it("answers an instant as RFC 3339", async () => {
        expect(await call("stamp", { at: "2026-11-18T10:52:23.500Z" })).toEqual({ status: 200, body: "2026-11-19T10:52:23.500Z" });
    });

    it("writes only when declared write: true, and the write still passes the policies as the caller", async () => {
        const refused = await call("add_proposal_read_only", { title: "Paris" }, adaBearer);
        expect(refused.status).toBe(500);
        expect(refused.body).toMatchObject({ error: { code: "RPC_READ_ONLY" } });

        const created = await call("add_proposal", { title: "Paris" }, adaBearer);
        expect(created.status).toBe(200);
        expect(created.body).toEqual(expect.objectContaining({ title: "Paris", owner_id: ada }));
        expect(await call("count_mine", undefined, adaBearer)).toEqual({ status: 200, body: 3 });
        expect(await call("count_mine", undefined, bobBearer)).toEqual({ status: 200, body: 1 });
    });

    it("answers RAISE EXCEPTION with 400 and the function's own message", async () => {
        const res = await call("refuse", { reason: "This proposal has expired" });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({
            error: { code: "RPC_EXCEPTION", message: "This proposal has expired", details: { sqlState: "P0001", hint: "ask the agency" } }
        });
    });

    it("serves only declared functions: one that exists but was not declared is 404", async () => {
        const res = await call("secret_count", {});
        expect(res.status).toBe(404);
        expect(res.body).toMatchObject({ error: { code: "RPC_NOT_FOUND" } });
    });
});
