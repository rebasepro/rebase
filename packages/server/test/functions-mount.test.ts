import { describe, expect, it, beforeEach, afterEach, jest } from "@jest/globals";
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { _resetRebaseMock } from "../src/singleton";

/**
 * The operational contract of the `/api/functions` mount, asserted through the
 * real `initializeRebaseBackend` wiring rather than through the shapes of the
 * middleware list.
 *
 * `test/fixtures` is used as the functions directory on purpose: it holds no
 * top-level `.ts`/`.js` file, so it is what a directory of functions looks like
 * when every one of them fails to import — the case that used to unmount the
 * whole router.
 */

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

/** @param withAuth how RLS scoping behaves — resolving, or wedged. */
function stubDriver(withAuth: "resolves" | "hangs"): DataDriver {
    const scoped = {
        fetchCollection: jest.fn(async () => [] as Record<string, unknown>[]),
        fetchOne: jest.fn(async () => undefined),
        save: jest.fn(async () => ({})),
        delete: jest.fn(async () => undefined)
    };
    return {
        ...scoped,
        healthCheck: jest.fn(async () => ({ healthy: true, latencyMs: 1 })),
        // Wedged only for request-time scoping: boot scopes the admin data
        // plane as `service` before any request exists, and a driver that
        // hangs there never finishes booting at all.
        withAuth: jest.fn(async (user: { uid: string }) => {
            if (withAuth === "hangs" && user.uid !== "service") {
                await new Promise(() => { /* a wedged connection never answers */ });
            }
            return scoped as unknown as DataDriver;
        })
    } as never;
}

function fakeBootstrapper(driver: DataDriver): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        }
    } as unknown as BackendBootstrapper;
}

/** A directory with no loadable function files — only subdirectories. */
const EMPTY_FUNCTIONS_DIR = path.join(__dirname, "fixtures");

async function boot(extra: Record<string, unknown> = {}, mode: "resolves" | "hangs" = "resolves") {
    const app = new Hono();
    await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [collection("widgets")],
        functionsDir: EMPTY_FUNCTIONS_DIR,
        bootstrappers: [fakeBootstrapper(stubDriver(mode))],
        ...extra
    } as never);
    return app;
}

const originalNodeEnv = process.env.NODE_ENV;
let warn: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
    process.env.NODE_ENV = "test";
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    _resetRebaseMock();
    process.env.NODE_ENV = originalNodeEnv;
    jest.restoreAllMocks();
});

describe("the functions router is mounted for the directory, not for the functions in it", () => {
    it("still answers when nothing loaded, and says how many files were skipped", async () => {
        const app = await boot();

        // Mounting on `loadedFunctions.length > 0` meant three files sharing
        // one import that throws on a missing env var took the entire surface
        // with them: /api/functions 404ed, and `rebase cloud debug` read that
        // 404 as "this build shipped no functions". An empty list is the
        // honest answer, and it is a debuggable one.
        const res = await app.request("/api/functions");
        expect(res.status).toBe(200);

        const body = await res.json() as { functions: unknown[]; skipped?: number; note?: string };
        expect(body.functions).toEqual([]);
        // Every subdirectory of `test/fixtures` is reported rather than silently
        // dropped. Counted from the directory rather than written as a literal:
        // it was `2`, and adding one unrelated fixture directory elsewhere in the
        // suite failed this test with a number that said nothing about the
        // behaviour it is guarding.
        const subdirectories = fs.readdirSync(EMPTY_FUNCTIONS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory() && !entry.name.startsWith(".")).length;
        expect(subdirectories).toBeGreaterThan(0);
        expect(body.skipped).toBe(subdirectories);
        expect(body.note).toMatch(/see the server log/);

        expect(warn.mock.calls.flat().join(" ")).toMatch(/no functions loaded/);
    });

    it("installs the unhandled-rejection guard while booting", async () => {
        // Wiring only — the handler's own behaviour is pinned in
        // `process-safety.test.ts`. Without this call, one fire-and-forget
        // promise in a function file ends a process shared by other tenants.
        await boot();
        expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(0);
    });
});

describe("anonymous rate limiting on the functions router", () => {
    it("bounds anonymous callers, and honours `rateLimit.anonymousFunctions`", async () => {
        const app = await boot({ rateLimit: { windowMs: 60_000, anonymousFunctions: 2 } });

        expect((await app.request("/api/functions")).status).toBe(200);
        expect((await app.request("/api/functions")).status).toBe(200);

        // The bucket used to be hardcoded off (`anonymous: null`) with no
        // override — so the one router that is public by default was also the
        // one with no ceiling on anonymous work.
        expect((await app.request("/api/functions")).status).toBe(429);
    });

    it("leaves the bucket off when asked explicitly", async () => {
        const app = await boot({ rateLimit: { windowMs: 60_000, anonymousFunctions: null } });

        for (let i = 0; i < 5; i++) {
            expect((await app.request("/api/functions")).status).toBe(200);
        }
    });
});

describe("request timeout on the functions router", () => {
    it("answers 504 instead of holding the socket forever", async () => {
        // A wedged driver hangs RLS scoping inside the auth middleware — the
        // same shape as a handler awaiting a fetch that never settles, and the
        // reason the timeout sits in FRONT of auth rather than behind it.
        const app = await boot({ functionsTimeoutMs: 50 }, "hangs");

        const res = await app.request("/api/functions");
        expect(res.status).toBe(504);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("FUNCTION_TIMEOUT");
    });
});
