import { describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import { getUserProfile } from "../src/index";
import type { HonoEnv } from "../src/api/types";
import { createUserProfileLoader, profileFromAccount } from "../src/auth/user-profile";
import type { AuthRepository } from "../src/auth/interfaces";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

/**
 * `getUserProfile(c)`: the caller's account as the auth store holds it. What
 * is pinned (the real boot and the Postgres store: `user-profile-e2e`):
 *
 * - the providers an account can sign in with, password first, then linked
 *   providers in the order they were linked, and the display name;
 * - a provider linked between two requests is in the second one — the read is
 *   the account now, not what the token was minted with;
 * - one request reads the store once, however often it asks;
 * - a service-key caller and an anonymous one get `undefined`.
 */

/** The store's repository, counting account reads. */
function counting(repo: AuthRepository): { source: AuthRepository; reads: () => number } {
    let reads = 0;
    return {
        source: {
            ...repo,
            getUserById: async (id: string) => {
                reads++;
                return repo.getUserById(id);
            }
        },
        reads: () => reads
    };
}

/** A functions-router stand-in: the caller set as an auth middleware would, then the loader. */
function app(source: AuthRepository) {
    const router = new Hono<HonoEnv>();
    router.use("/*", async (c, next) => {
        const uid = c.req.header("x-test-uid");
        if (uid) c.set("user", { uid, roles: [] });
        return next();
    });
    router.use("/*", createUserProfileLoader(source));
    router.get("/", async (c) => {
        const first = await getUserProfile(c);
        const second = await getUserProfile(c);
        return c.json({ profile: first ?? null, same: first === second });
    });
    return router;
}

async function ask(router: Hono<HonoEnv>, uid?: string) {
    const res = await router.request("/", uid ? { headers: { "x-test-uid": uid } } : {});
    expect(res.status).toBe(200);
    return await res.json() as { profile: Record<string, unknown> | null; same: boolean };
}

describe("getUserProfile", () => {
    it("reads the caller's providers and display name, and a provider linked since on the next request", async () => {
        const store = new MemoryAuthStore();
        const repo = store.repo();
        const { source, reads } = counting(repo);
        const user = await repo.createUser({ email: "ada@example.com", passwordHash: "x", displayName: "Ada", emailVerified: true });
        const router = app(source);

        const before = await ask(router, user.id);
        expect(before.profile).toEqual({
            uid: user.id,
            email: "ada@example.com",
            displayName: "Ada",
            emailVerified: true,
            isAnonymous: false,
            providers: ["password"]
        });
        expect(before.same).toBe(true);
        expect(reads()).toBe(1);

        await repo.linkUserIdentity(user.id, "google", "g-1", {});
        const after = await ask(router, user.id);
        expect(after.profile?.providers).toEqual(["password", "google"]);
        expect(reads()).toBe(2);
    });

    it("is undefined for a service-key caller and an anonymous one, and reads nothing", async () => {
        const { source, reads } = counting(new MemoryAuthStore().repo());
        const router = app(source);
        expect((await ask(router, "service")).profile).toBeNull();
        expect((await ask(router)).profile).toBeNull();
        expect(reads()).toBe(0);
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
