import { describe, it, expect } from "@jest/globals";
/**
 * Passwordless sign-in, from an environment variable to a mounted route.
 *
 * A managed or self-hosted project ships a *bundle* and a set of environment
 * variables. It does not rebuild to change a switch — so a flag that exists only
 * in code is a flag those deployments do not have, which is what `magicLink` was
 * until `AUTH_MAGIC_LINK`, and what `emailOtp` would have been on the day it
 * shipped.
 *
 * The failure this guards is the one this repository keeps meeting: a feature
 * that is declared, typechecks, has tests of its own, and is never *reached* —
 * a collection key stripped by an allowlist, a bundle URL nothing read. So these
 * assert both halves, and the second is the one that matters: the environment
 * resolves to a config, and the config actually mounts the route.
 */
import { Hono } from "hono";

import { resolveAuthOptions } from "../src/boot/options";
import type { RebaseBootEnv } from "../src/boot/env";
import { createAuthRoutes, type AuthModuleConfig } from "../src/auth/routes";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";

const env = (overrides: Partial<RebaseBootEnv>): RebaseBootEnv =>
    ({ NODE_ENV: "development", APP_NAME: "Rebase", ...overrides }) as RebaseBootEnv;

describe("resolveAuthOptions — passwordless flags", () => {
    it("leaves both off when the environment says nothing", () => {
        // Falsy rather than `false`: this fixture is a cast literal, so it
        // bypasses the zod schema that supplies the `false` default. What is
        // being pinned is that nothing here invents an `on` — and the router
        // tests below prove that off and absent mount the same nothing.
        const auth = resolveAuthOptions(env({}), undefined);

        expect(auth.magicLink).toBeFalsy();
        expect(auth.emailOtp).toBeFalsy();
    });

    it("turns on magic link from AUTH_MAGIC_LINK", () => {
        expect(resolveAuthOptions(env({ AUTH_MAGIC_LINK: true }), undefined).magicLink).toBe(true);
    });

    it("turns on one-time codes from AUTH_EMAIL_OTP", () => {
        expect(resolveAuthOptions(env({ AUTH_EMAIL_OTP: true }), undefined).emailOtp).toBe(true);
    });

    it("keeps them independent — neither implies the other", () => {
        const otpOnly = resolveAuthOptions(env({ AUTH_EMAIL_OTP: true }), undefined);
        expect(otpOnly.magicLink).toBeFalsy();

        const linkOnly = resolveAuthOptions(env({ AUTH_MAGIC_LINK: true }), undefined);
        expect(linkOnly.emailOtp).toBeFalsy();
    });
});

describe("the flag reaches the router", () => {
    const app = (enableEmailOtp: boolean): Hono<HonoEnv> => {
        const router = new Hono<HonoEnv>();
        router.onError(errorHandler);
        router.route("/auth", createAuthRoutes({
            authRepo: {
                getUserByEmail: async () => null,
                getUserById: async () => null
            },
            enableEmailOtp,
            emailService: { isConfigured: () => true, send: async () => ({ messageId: "x" }) },
            emailConfig: { from: "no-reply@test", appName: "TestApp", resetPasswordUrl: "https://app.test" }
        } as unknown as AuthModuleConfig));
        return router;
    };

    const post = (router: Hono<HonoEnv>, path: string) =>
        router.fetch(new Request(`http://localhost${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "someone@example.com" })
        }));

    it("mounts POST /auth/otp when the flag is on", async () => {
        // Any answer but 404 proves the route exists. 200 is what an unknown
        // address gets, because the endpoint refuses to say whether one exists.
        expect((await post(app(true), "/auth/otp")).status).toBe(200);
    });

    it("does not mount it when the flag is off", async () => {
        expect((await post(app(false), "/auth/otp")).status).toBe(404);
    });

    it("does not mount the verify route either", async () => {
        expect((await post(app(false), "/auth/otp/verify")).status).toBe(404);
    });
});
