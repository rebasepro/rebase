/**
 * A magic link and a password-reset link are spent once, also when two
 * requests present one at the same moment.
 *
 * Each route looks the token up, finds it valid, and only then marks it used.
 * Two requests in flight together both pass the lookup before either mark
 * lands, so a mark that does not say whether it took the token let both sign
 * in, or both set a password. The mark is the check: the repository consumes
 * the token only while it is still valid and reports whether this call did,
 * and the request that lost is refused.
 */

import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { hashToken } from "../src/auth/admin-user-ops";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const HOOKS: AuthHooks = {
    hashPassword: async (password: string) => `hashed:${password}`,
    verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`
};

beforeAll(() => {
    configureJwt({ secret: "auth-single-use-tokens-secret-at-least-32-chars", accessExpiresIn: "1h" });
});

function createApp(store: MemoryAuthStore): Hono<HonoEnv> {
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        authHooks: HOOKS,
        enableMagicLink: true
    }));
    return app;
}

function post(app: Hono<HonoEnv>, path: string, body: Record<string, unknown>) {
    return Promise.resolve(app.request(`/auth${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }));
}

const inAnHour = () => new Date(Date.now() + 60 * 60 * 1000);

describe("a single-use token presented twice at once", () => {
    it("signs in one magic-link request and refuses the other", async () => {
        const store = new MemoryAuthStore();
        const user = await store.repo().createUser({ email: "link@example.com", emailVerified: true });
        await store.repo().createMagicLinkToken(user.id, hashToken("link-token"), inAnHour());
        const app = createApp(store);

        const answers = await Promise.all([
            post(app, "/magic-link/verify", { token: "link-token" }),
            post(app, "/magic-link/verify", { token: "link-token" })
        ]);

        expect(answers.map(res => res.status).sort()).toEqual([200, 400]);
    });

    it("lets one reset request set a password and refuses the other", async () => {
        const store = new MemoryAuthStore();
        const user = await store.repo().createUser({ email: "reset@example.com", passwordHash: "hashed:Old-Passw0rd!", emailVerified: true });
        await store.repo().createPasswordResetToken(user.id, hashToken("reset-token"), inAnHour());
        const app = createApp(store);

        const answers = await Promise.all([
            post(app, "/reset-password", { token: "reset-token", password: "First-Passw0rd!" }),
            post(app, "/reset-password", { token: "reset-token", password: "Second-Passw0rd!" })
        ]);

        expect(answers.map(res => res.status).sort()).toEqual([200, 400]);
        const winner = answers[0].status === 200 ? "First-Passw0rd!" : "Second-Passw0rd!";
        expect((await store.repo().getUserById(user.id))?.passwordHash).toBe(`hashed:${winner}`);
    });
});
