/**
 * E2E: `getUserProfile(c)` in a custom function reads the caller's account
 * from the Postgres auth store — display name, and the providers it can sign
 * in with — through the real boot and functions mount.
 *
 * An application that needed to know whether its caller signs in with Google
 * read `rebase.user_identities` with raw SQL. What must hold here:
 *
 * - password first, then linked providers in the order they were linked;
 * - a provider linked after the token was minted is in the next request;
 * - a service-key caller is no account.
 *
 * Requires Docker.
 */
import { createServer } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { defineFunction, getUserProfile, initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "user-profile-e2e-secret-that-is-long-enough-0123456789";
const SERVICE_KEY = "user-profile-e2e-service-key-0123456789abcdef";

const notes: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
};

describe("getUserProfile against the Postgres auth store (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    let repo: AuthRepository;
    const app = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;

    async function profileAs(authorization: string) {
        const res = await app.request("/api/functions/me", { headers: { authorization } });
        expect(res.status).toBe(200);
        return (await res.json() as { profile: Record<string, unknown> | null }).profile;
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        const me = defineFunction((fn) => {
            fn.get("/", async (c) => c.json({ profile: (await getUserProfile(c)) ?? null }));
        });
        backend = await initializeRebaseBackend({
            app,
            server: createServer(),
            collections: [notes],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            functions: { me },
            cronPersistence: false
        });
        const booted = backend.auth?.authRepository as AuthRepository | undefined;
        if (!booted) throw new Error("the boot set up no auth repository");
        repo = booted;
    }, 180_000);

    afterAll(async () => {
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("reads providers and display name, and sees a provider linked since the token was minted", async () => {
        const user = await repo.createUser({ email: "ada@profile.test", passwordHash: "x", displayName: "Ada Lovelace", emailVerified: true });
        const bearer = `Bearer ${await generateAccessToken(user.id, [])}`;

        expect(await profileAs(bearer)).toEqual({
            uid: user.id,
            email: "ada@profile.test",
            displayName: "Ada Lovelace",
            emailVerified: true,
            isAnonymous: false,
            providers: ["password"]
        });

        await repo.linkUserIdentity(user.id, "apple", "apple-1", {});
        await repo.linkUserIdentity(user.id, "google", "google-1", {});
        expect((await profileAs(bearer))?.providers).toEqual(["password", "apple", "google"]);
    });

    it("is no account for a service-key caller", async () => {
        expect(await profileAs(`Bearer ${SERVICE_KEY}`)).toBeNull();
    });
});
