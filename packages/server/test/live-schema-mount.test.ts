import { describe, it, expect } from "@jest/globals";
/**
 * That live schema editing is actually reachable from a booted backend.
 *
 * The routes are unit-tested elsewhere; what this pins is the wiring, which is
 * the half that silently does not exist. A feature mounted behind a condition
 * nobody re-checks is how the schema editor ended up dev-only in the first
 * place.
 *
 * Two things worth asserting here and nowhere else:
 *
 * - it is mounted **outside** the `NODE_ENV=production` gate that the
 *   source-only editor sits behind, because the question is whether a
 *   repository exists, not whether this is production;
 * - it is behind the admin gate, like every other admin surface. A route that
 *   rewrites a schema and commits to a repository is not one to leave open.
 *
 * Both are asserted through the gate's own 401 rather than by reaching past it:
 * getting a 401 instead of a 404 proves the route exists and is protected, and
 * that is precisely the pair this file is for.
 */
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import { initializeRebaseBackend } from "../src/init";

const JWT_SECRET = "live-schema-mount-test-secret-1234567890";

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

/**
 * A driver that answers enough for a boot and **cannot plan schema changes** —
 * which is the point: it stands in for Mongo or Firebase, and proves the
 * capability is detected structurally rather than assumed.
 */
const bootstrapper = {
    type: "fake",
    isDefault: true,
    async initializeDriver() {
        return {
            driver: {
                type: "fake",
                registry: { get: () => undefined, getCollections: () => [] },
                fetchCollection: async () => [],
                admin: { executeSql: async () => ({ rows: [] }) }
            },
            collections: [],
            internals: {}
        };
    },
    // Enough for the built-in auth adapter to be constructed; nothing here
    // logs in.
    async initializeAuth() {
        return { userService: {}, authRepository: {} };
    }
} as never;

async function boot(collectionsDir: string | undefined) {
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("posts")],
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        ...(collectionsDir ? { collectionsDir } : {}),
        auth: { requireAuth: false, jwtSecret: JWT_SECRET }
    } as never);
    return {
        app,
        stop: () => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.()
    };
}

const post = (app: Hono, body: unknown) =>
    app.fetch(new Request("http://localhost/api/schema/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));

describe("live schema editing, as mounted", () => {
    it("is reachable when a collectionsDir is configured", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-live-schema-"));
        const { app, stop } = await boot(dir);
        try {
            const res = await post(app, { collectionId: "posts", collection: { name: "Posts" } });

            // 401, not 404: the route exists *and* the admin gate is in front
            // of it. Those are the two things worth pinning here — a route that
            // rewrites a schema and commits to a repository must not be open,
            // and a feature nobody can reach may as well not be built.
            //
            // What it answers once past the gate — the capability refusal, the
            // plan itself — is covered in `live-schema-routes.test.ts`, where
            // the driver can be varied without booting a backend per case.
            expect(res.status).toBe(401);
            expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
        } finally {
            stop();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it("is absent when there is no collectionsDir to edit", async () => {
        const { app, stop } = await boot(undefined);
        try {
            const res = await post(app, { collectionId: "posts", collection: {} });
            expect(res.status).toBe(404);
        } finally {
            stop();
        }
    });

    it("stays mounted under NODE_ENV=production, unlike the source-only editor", async () => {
        const previous = process.env.NODE_ENV;
        process.env.NODE_ENV = "production";
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-live-schema-prod-"));
        try {
            const { app, stop } = await boot(dir);
            try {
                const res = await post(app, { collectionId: "posts", collection: { name: "Posts" } });
                // The source-only editor answers 501 SCHEMA_EDITOR_PRODUCTION
                // here, because it edits files a deploy would overwrite. This
                // one is gated on having a repository, not on the environment,
                // so production reaches the same admin gate as anywhere else.
                expect(res.status).toBe(401);
                const body = await res.json() as { error?: { code?: string } };
                expect(body.error?.code).not.toBe("SCHEMA_EDITOR_PRODUCTION");
            } finally {
                stop();
            }
        } finally {
            if (previous === undefined) delete process.env.NODE_ENV;
            else process.env.NODE_ENV = previous;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
