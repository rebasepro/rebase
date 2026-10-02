/**
 * The auth hooks hold on every door they are documented for.
 *
 * - A refusal is the caller's answer, not a server fault: a `beforeUserCreate`
 *   that limits sign-ups to one domain answered an outsider with a 500.
 * - OAuth sign-in ran neither `beforeUserCreate` nor `beforeLogin` nor
 *   `onAuthenticated`, so the same outsider got in with "Sign in with Google",
 *   and a banned address signed in through any provider.
 * - Every value of `AuthMethod` is passed to `onAuthenticated` by some route,
 *   which is what its documentation promises.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { configureJwt } from "../src/auth/jwt";
import { oauthCodeFlowSchema } from "../src/auth/oauth-code-flow";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

beforeAll(() => configureJwt({ secret: "auth-hooks-every-door-secret-0123456789", accessExpiresIn: "1h" }));

function world(hooks: AuthHooks, profileEmail: string) {
    const store = new MemoryAuthStore();
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/auth", createAuthRoutes({
        authRepo: store.repo(),
        allowRegistration: true,
        authHooks: {
            hashPassword: async (password: string) => `hashed:${password}`,
            verifyPassword: async (password: string, stored: string) => stored === `hashed:${password}`,
            ...hooks
        },
        oauthProviders: [{
            id: "google",
            schema: oauthCodeFlowSchema(),
            verify: async () => ({ providerId: `g-${profileEmail}`, email: profileEmail, emailVerified: true })
        }]
    }));
    const post = async (path: string, body: unknown) => {
        const res = await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        return { status: res.status, json: await res.json() as { error?: { code: string; message: string } } };
    };
    return { store, post };
}

const companyOnly: AuthHooks = {
    beforeUserCreate: async (data) => {
        if (!data.email.endsWith("@company.com")) throw new Error("Only @company.com may sign up");
        return data;
    }
};

describe("a refusing hook", () => {
    it("answers 400 HOOK_REJECTED with its message on registration, not 500", async () => {
        const { post } = world(companyOnly, "outsider@gmail.com");
        const res = await post("/auth/register", { email: "outsider@gmail.com", password: "Passw0rd-Outsider" });
        expect(res.status).toBe(400);
        expect(res.json.error).toMatchObject({ code: "HOOK_REJECTED", message: "Only @company.com may sign up" });
    });

    it("keeps the status an error carries", async () => {
        const { post } = world({
            beforeLogin: async () => { throw Object.assign(new Error("Account locked"), { status: 403 }); }
        }, "x@company.com");
        const res = await post("/auth/login", { email: "x@company.com", password: "whatever" });
        expect(res.status).toBe(403);
        expect(res.json.error?.message).toBe("Account locked");
    });

    it("refuses an OAuth sign-up too", async () => {
        const { store, post } = world(companyOnly, "outsider@gmail.com");
        const res = await post("/auth/google", { code: "c", redirectUri: "https://app.test/cb" });
        expect(res.status).toBe(400);
        expect(res.json.error?.code).toBe("HOOK_REJECTED");
        expect(store.users.size).toBe(0);
    });

    it("refuses an OAuth sign-in to a banned address through beforeLogin", async () => {
        const seen: string[] = [];
        const { post } = world({
            beforeLogin: async (email, method) => {
                seen.push(`${method}:${email}`);
                if (email.startsWith("banned")) throw Object.assign(new Error("Account locked"), { status: 403 });
            }
        }, "banned@company.com");
        const res = await post("/auth/google", { code: "c", redirectUri: "https://app.test/cb" });
        expect(res.status).toBe(403);
        expect(seen).toEqual(["oauth:banned@company.com"]);
    });
});

describe("onAuthenticated", () => {
    it("hears an OAuth sign-in", async () => {
        const methods: string[] = [];
        const { post } = world({ onAuthenticated: async (_user, method) => { methods.push(method); } }, "member@company.com");
        expect((await post("/auth/google", { code: "c", redirectUri: "https://app.test/cb" })).status).toBe(200);
        await new Promise(resolve => setImmediate(resolve));
        expect(methods).toEqual(["oauth"]);
    });

    it("is passed every value of AuthMethod by some route (source guard)", () => {
        const hooksSource = readFileSync(join(__dirname, "../src/auth/auth-hooks.ts"), "utf8");
        const union = /export type AuthMethod = ([^;]+);/.exec(hooksSource)![1];
        const methods = [...union.matchAll(/"([^"]+)"/g)].map(m => m[1]);
        const dir = join(__dirname, "../src/auth");
        const sources = readdirSync(dir).filter(f => f.endsWith(".ts")).map(f => readFileSync(join(dir, f), "utf8")).join("\n");
        const unpassed = methods.filter(method => !new RegExp(`onAuthenticated\\([^)]*"${method}"\\)`).test(sources));
        expect(unpassed).toEqual([]);
    });
});
