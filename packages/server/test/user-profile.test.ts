import { afterEach, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { defineFunction, getUserProfile, initializeRebaseBackend } from "../src/index";
import { generateAccessToken } from "../src/auth/jwt";
import { profileFromAccount } from "../src/auth/user-profile";
import { _resetRebaseMock } from "../src/singleton";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

/**
 * `getUserProfile(c)`: the caller's account as the auth store holds it, read
 * through the real functions mount. What is pinned:
 *
 * - the providers an account can sign in with, password first, then linked
 *   providers in the order they were linked, and the display name;
 * - a provider linked between two requests is in the second one — the read is
 *   the account now, not what the token was minted with;
 * - one request reads the store once, however often it asks;
 * - a service-key caller and an anonymous one get `undefined`.
 */

const SERVICE_KEY = "profile-test-service-key-0123456789abcdef!";
const JWT_SECRET = "profile-test-jwt-secret-0123456789abcdef";

const widgets = {
    name: "widgets",
    slug: "widgets",
    table: "widgets",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
} as unknown as CollectionConfig;

function bootstrapper(store: MemoryAuthStore): BackendBootstrapper {
    const driver = {
        fetchCollection: async () => [],
        withAuth: async () => driver,
        admin: { executeSql: async () => [] }
    };
    const repo = store.repo();
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: repo, authRepository: repo };
        }
    } as unknown as BackendBootstrapper;
}

const stops: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (stops.length) await stops.pop()!();
    _resetRebaseMock();
});

/** Counts the store's account reads, so a test can say how many a request made. */
function counting(store: MemoryAuthStore): { reads: () => number } {
    const repo = store.repo.bind(store);
    let reads = 0;
    store.repo = () => {
        const inner = repo();
        return {
            ...inner,
            getUserById: async (id: string) => {
                reads++;
                return inner.getUserById(id);
            }
        };
    };
    return { reads: () => reads };
}

async function boot(store: MemoryAuthStore) {
    const app = new Hono();
    const profile = defineFunction((fn) => {
        fn.get("/", async (c) => {
            const first = await getUserProfile(c);
            const second = await getUserProfile(c);
            return c.json({ profile: first ?? null, same: first === second });
        });
    });
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: { close: (cb: () => void) => cb() } as never,
        collections: [widgets],
        bootstrappers: [bootstrapper(store)],
        auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
        cronPersistence: false,
        functions: { profile }
    } as never);
    stops.push(() => backend.shutdown(0));
    return app;
}

async function ask(app: Hono, authorization?: string) {
    const res = await app.request("/api/functions/profile", authorization ? { headers: { authorization } } : {});
    expect(res.status).toBe(200);
    return await res.json() as { profile: Record<string, unknown> | null; same: boolean };
}

describe("getUserProfile", () => {
    it("reads the caller's providers and display name, and a provider linked since on the next request", async () => {
        const store = new MemoryAuthStore();
        const { reads } = counting(store);
        const repo = store.repo();
        const user = await repo.createUser({ email: "ada@example.com", passwordHash: "x", displayName: "Ada", emailVerified: true });
        const app = await boot(store);
        const bearer = `Bearer ${await generateAccessToken(user.id, [])}`;

        const before = await ask(app, bearer);
        expect(before.profile).toEqual({
            uid: user.id,
            email: "ada@example.com",
            displayName: "Ada",
            emailVerified: true,
            isAnonymous: false,
            providers: ["password"]
        });
        expect(before.same).toBe(true);
        const readsForOneRequest = reads();
        expect(readsForOneRequest).toBe(1);

        await repo.linkUserIdentity(user.id, "google", "g-1", {});
        const after = await ask(app, bearer);
        expect(after.profile?.providers).toEqual(["password", "google"]);
        expect(reads()).toBe(2);
    });

    it("is undefined for a service-key caller and an anonymous one", async () => {
        const app = await boot(new MemoryAuthStore());
        expect((await ask(app, `Bearer ${SERVICE_KEY}`)).profile).toBeNull();
        expect((await ask(app)).profile).toBeNull();
    });
});

describe("profileFromAccount", () => {
    const at = (iso: string) => new Date(iso);
    const identity = (provider: string, createdAt: string) => ({
        id: provider, uid: "u", provider, providerId: provider, createdAt: at(createdAt), updatedAt: at(createdAt)
    });

    it("lists linked providers oldest first, once each, with no password on an account without one", () => {
        const profile = profileFromAccount(
            { id: "u", email: "", emailVerified: false, isAnonymous: true, createdAt: at("2026-01-01"), updatedAt: at("2026-01-01") },
            [identity("apple", "2026-03-01"), identity("google", "2026-02-01"), identity("google", "2026-04-01")]
        );
        expect(profile).toEqual({ uid: "u", emailVerified: false, isAnonymous: true, providers: ["google", "apple"] });
    });
});
