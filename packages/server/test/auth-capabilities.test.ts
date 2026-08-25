/**
 * The `GET /auth/config` payload.
 *
 * These tests used to live in `auth-routes.test.ts`, against a copy of the
 * endpoint mounted on the auth router — a handler production never reached,
 * because `init.ts` registers the same path first. Two handlers, two shapes,
 * and a fix could land on the wrong one without a single test noticing.
 *
 * There is now one builder, and this pins both what it answers and the exact
 * set of keys it answers with: the drift that started this was a *field name*
 * (`emailServiceEnabled` vs `passwordReset`), which no per-field assertion sees.
 */

import { describe, it, expect } from "@jest/globals";
import { buildBuiltinAuthCapabilities } from "../src/auth/capabilities";

const base = {
    needsSetup: false,
    emailConfigured: false,
    enabledProviders: [] as string[]
};

describe("buildBuiltinAuthCapabilities", () => {
    describe("registrationEnabled", () => {
        it("opens on an empty user table, whatever allowRegistration says", () => {
            // Otherwise a backend deployed with `allowRegistration: false` is a
            // dead end: bootstrapping an admin needs an authenticated caller,
            // and an empty database cannot produce one.
            expect(buildBuiltinAuthCapabilities({
                ...base, needsSetup: true, allowRegistration: false
            }).registrationEnabled).toBe(true);
        });

        it("stays shut on an empty table when disableSelfRegistration is set", () => {
            const caps = buildBuiltinAuthCapabilities({
                ...base, needsSetup: true, allowRegistration: true, disableSelfRegistration: true
            });
            expect(caps.registrationEnabled).toBe(false);
            // needsSetup still reports the truth: the database really is empty,
            // and the login screen uses it to explain why nothing signs in.
            expect(caps.needsSetup).toBe(true);
        });

        it("follows allowRegistration once a user exists", () => {
            expect(buildBuiltinAuthCapabilities({ ...base, allowRegistration: true }).registrationEnabled).toBe(true);
            expect(buildBuiltinAuthCapabilities({ ...base, allowRegistration: false }).registrationEnabled).toBe(false);
        });
    });

    describe("the email-borne flows", () => {
        it("advertises nothing that needs an email service when none is configured", () => {
            const caps = buildBuiltinAuthCapabilities({ ...base, enableMagicLink: true });
            expect(caps.passwordReset).toBe(false);
            expect(caps.emailVerification).toBe(false);
            expect(caps.magicLink).toBe(false);
        });

        it("needs the magic-link switch as well as the email service", () => {
            expect(buildBuiltinAuthCapabilities({ ...base, emailConfigured: true }).magicLink).toBe(false);
            expect(buildBuiltinAuthCapabilities({
                ...base, emailConfigured: true, enableMagicLink: true
            }).magicLink).toBe(true);
        });

        it("keeps adminPasswordReset on without an email service", () => {
            // The admin route falls back to handing back a one-time temporary
            // password, so it works with no mail transport at all.
            expect(buildBuiltinAuthCapabilities(base).adminPasswordReset).toBe(true);
        });
    });

    describe("anonymousLogin", () => {
        it("is off unless the deployment opted in", () => {
            expect(buildBuiltinAuthCapabilities(base).anonymousLogin).toBe(false);
            expect(buildBuiltinAuthCapabilities({ ...base, allowAnonymous: true }).anonymousLogin).toBe(true);
        });

        it("is closed by the registration kill switch", () => {
            // Anonymous sign-in inserts a users row like any registration does.
            expect(buildBuiltinAuthCapabilities({
                ...base, allowAnonymous: true, disableSelfRegistration: true
            }).anonymousLogin).toBe(false);
        });
    });

    it("reports the wired OAuth providers verbatim", () => {
        expect(buildBuiltinAuthCapabilities({
            ...base, enabledProviders: ["google", "github"]
        }).enabledProviders).toEqual(["google", "github"]);
    });

    it("answers with exactly these keys", () => {
        // The wire contract. A client reads these names; renaming or dropping
        // one is a breaking change and has to fail here first. `AuthConfig` in
        // `@rebasepro/client` and `AuthConfigResponse` in `@rebasepro/app` are
        // both aliases of `AuthAdapterCapabilities`, so the types cannot drift
        // from each other — only this can drift from the types.
        expect(Object.keys(buildBuiltinAuthCapabilities(base)).sort()).toEqual([
            "adminPasswordReset",
            "anonymousLogin",
            "emailOtp",
            "emailPasswordLogin",
            "emailVerification",
            "enabledProviders",
            "hasBuiltInAuthRoutes",
            "magicLink",
            "needsSetup",
            "passwordReset",
            "profileUpdate",
            "registrationEnabled",
            "sessionManagement"
        ]);
    });
});
