/**
 * `storageAuthorize`'s `ctx.data` reads past row-level security, as its type
 * and the scaffold say (E2E).
 *
 * It was scoped as the service identity, which policies do apply to. On a
 * table with `defaultPolicies: false` and one owner policy, exactly what
 * introspecting a Supabase schema produces, the hook's ownership lookup found
 * nothing, and every upload was refused with a bare 403.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { Hono } from "hono";
import { col, defineTable } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "storage-authorize-data-e2e-secret-long-enough-0123456789";
const SERVICE_KEY = "storage-authorize-data-e2e-service-key-0123456789abcdef";

/** An agency is its owner's alone: no admin baseline, one owner policy. */
const agencies = defineTable("agencies", {
    columns: {
        id: col.text().primaryKey(),
        ownerId: col.text().notNull()
    },
    rls: [{ name: "agencies_owner", operation: "all", using: "(owner_id = (SELECT rebase.uid()))" }],
    defaultPolicies: false
});

describe("storageAuthorize's data reader on an owner-only table (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    let storageDir: string;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const owner = { uid: "", token: "" };
    const stranger = { uid: "", token: "" };
    const writesSeen: string[] = [];

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        storageDir = mkdtempSync(join(tmpdir(), "rebase-storage-authorize-data-"));
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server,
            tables: [agencies],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            storage: { type: "local", basePath: storageDir },
            storageAuthorize: async ({ key, user, operation, data }) => {
                if (!user || operation !== "write") return false;
                const agencyId = key.split("/")[1];
                const agency = await data?.table("agencies").findById(agencyId);
                // The reader is read-only, whatever the hook tries.
                const table = data?.table("agencies");
                for (const name of Object.keys(table ?? {})) if (name !== "find" && name !== "findById") writesSeen.push(name);
                return agency?.ownerId === user.uid || agency?.owner_id === user.uid;
            }
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("no auth repository");
        for (const [who, email] of [[owner, "owner@agency.test"], [stranger, "stranger@agency.test"]] as const) {
            const user = await repo.createUser({ email, emailVerified: true });
            who.uid = user.id;
            who.token = await generateAccessToken(user.id, [], "aal1");
        }
        await admin.query("INSERT INTO agencies (id, owner_id) VALUES ('a1', $1)", [owner.uid]);
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
        if (storageDir) rmSync(storageDir, { recursive: true, force: true });
    }, 60_000);

    async function upload(token: string): Promise<number> {
        const form = new FormData();
        form.append("file", new Blob(["%PDF-1.4"], { type: "application/pdf" }), "bono.pdf");
        form.append("key", "agencies/a1/bono.pdf");
        const response = await app.request("/api/storage/upload", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });
        return response.status;
    }

    it("lets the owner upload: the hook's lookup sees the row the owner policy hides from the service identity", async () => {
        expect(await upload(owner.token)).toBe(201);
    });

    it("still refuses a caller who does not own the row", async () => {
        expect(await upload(stranger.token)).toBe(403);
    });

    it("hands the hook a reader with no write on it", () => {
        expect(writesSeen).toEqual([]);
    });
});
