/**
 * Accounts imported with the password hash another system stored.
 *
 * Moving an app off Supabase moved its users without passwords: every one of
 * them had to reset before signing in again, which is the reason a team with
 * real users does not move. Supabase stores bcrypt (`auth.users.
 * encrypted_password`), so an import that names the format keeps the hash,
 * the account signs in with the password it had, and the first sign-in swaps
 * the hash for Rebase's own scrypt.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { Hono } from "hono";
import { hashSync } from "bcryptjs";
import { importedPasswordHashProblem, type ImportUsersResult } from "@rebasepro/types";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { createAuthRoutes } from "../src/auth/routes";
import type { AuthHooks } from "../src/auth/auth-hooks";
import { isBcryptHash, verifyPassword } from "../src/auth/password";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import { configureJwt } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const SERVICE_KEY = "import-password-hashes-service-key-0123456789";
const SUPABASE_ID = "7f3c2a10-5b1e-4f7a-9a51-0d2a6b1c9e44";
const EMAIL = "ada@example.com";
const PASSWORD = "Old-Supabase-Passw0rd";
/** Cost 4 keeps the test fast; Supabase writes cost 10, and the format is the same. */
const BCRYPT = hashSync(PASSWORD, 4);
/** What Go's bcrypt (Supabase's GoTrue) writes: the `$2a$` prefix. */
const BCRYPT_2A = BCRYPT.replace(/^\$2b\$/, "$2a$");

beforeAll(() => configureJwt({ secret: "import-password-hashes-secret-0123456789abcdef", accessExpiresIn: "1h" }));

function world(authHooks?: AuthHooks) {
    const store = new MemoryAuthStore();
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/admin", createAdminUsersRoute({ authRepo: store.repo(), serviceKey: SERVICE_KEY, ...(authHooks ? { authHooks } : {}) }));
    app.route("/auth", createAuthRoutes({ authRepo: store.repo(), ...(authHooks ? { authHooks } : {}) }));
    const importUsers = async (body: unknown) => {
        const res = await app.request("/admin/users/import", {
            method: "POST",
            headers: { authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return { status: res.status, body: await res.json() as ImportUsersResult & { error?: { code: string; message: string } } };
    };
    const login = async (email: string, password: string) => {
        const res = await app.request("/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        return { status: res.status, body: await res.json() as { error?: { code: string } } };
    };
    return { store, importUsers, login };
}

describe("importing bcrypt password hashes", () => {
    it("keeps the hash, signs in with the old password, and swaps it for scrypt on that sign-in", async () => {
        const { store, importUsers, login } = world();

        const { status, body } = await importUsers({
            passwordHashAlgorithm: "bcrypt",
            users: [{ id: SUPABASE_ID, email: EMAIL, emailVerified: true, passwordHash: BCRYPT_2A }]
        });
        expect(status).toBe(200);
        expect(body).toMatchObject({ created: 1, failed: 0 });
        expect(store.users.get(SUPABASE_ID)?.passwordHash).toBe(BCRYPT_2A);

        expect((await login(EMAIL, "Wrong-Passw0rd")).status).toBe(401);
        expect(store.users.get(SUPABASE_ID)?.passwordHash).toBe(BCRYPT_2A);

        expect((await login(EMAIL, PASSWORD)).status).toBe(200);
        const upgraded = store.users.get(SUPABASE_ID)?.passwordHash;
        expect(upgraded).toBeTruthy();
        expect(isBcryptHash(upgraded ?? "")).toBe(false);
        expect(await verifyPassword(PASSWORD, upgraded ?? "")).toBe(true);

        // And it keeps working on the scrypt hash.
        expect((await login(EMAIL, PASSWORD)).status).toBe(200);
        expect((await login(EMAIL, "Wrong-Passw0rd")).status).toBe(401);
    });

    it("keeps the hash through a beforeUserCreate hook that rebuilds the account", async () => {
        const { store, importUsers } = world({ beforeUserCreate: async (data) => ({ email: data.email, displayName: "hooked" }) });

        await importUsers({ passwordHashAlgorithm: "bcrypt", users: [{ id: SUPABASE_ID, email: EMAIL, passwordHash: BCRYPT }] });

        expect(store.users.get(SUPABASE_ID)).toMatchObject({ displayName: "hooked", passwordHash: BCRYPT });
    });

    it("leaves the hash alone when the project has its own password hooks", async () => {
        const { compare, hash } = await import("bcryptjs");
        const { store, importUsers, login } = world({
            hashPassword: async (password) => hash(password, 4),
            verifyPassword: async (password, stored) => compare(password, stored)
        });

        await importUsers({ passwordHashAlgorithm: "bcrypt", users: [{ id: SUPABASE_ID, email: EMAIL, emailVerified: true, passwordHash: BCRYPT }] });

        expect((await login(EMAIL, PASSWORD)).status).toBe(200);
        expect(store.users.get(SUPABASE_ID)?.passwordHash).toBe(BCRYPT);
    });

    it("refuses a hash whose format the request does not name", async () => {
        const { store, importUsers } = world();

        const { body } = await importUsers({ users: [{ email: EMAIL, passwordHash: BCRYPT }] });

        expect(body).toMatchObject({ created: 0, failed: 1 });
        expect(body.results[0]).toMatchObject({ code: "INVALID_INPUT", message: expect.stringMatching(/passwordHashAlgorithm/) });
        expect(store.users.size).toBe(0);
    });

    it("refuses what is not a bcrypt hash, without echoing it", async () => {
        const { store, importUsers } = world();
        const scrypt = `${"a".repeat(64)}:${"b".repeat(128)}`;

        const { body } = await importUsers({
            passwordHashAlgorithm: "bcrypt",
            users: [
                { email: "plain@example.com", passwordHash: "hunter2hunter2" },
                { email: "scrypt@example.com", passwordHash: scrypt },
                { email: "number@example.com", passwordHash: 42 },
                { email: "fine@example.com", passwordHash: BCRYPT },
                { email: "none@example.com" }
            ]
        });

        expect(body).toMatchObject({ created: 2, failed: 3 });
        expect(body.results.slice(0, 3).map(r => ("code" in r ? r.code : r.status))).toEqual(["INVALID_PASSWORD_HASH", "INVALID_PASSWORD_HASH", "INVALID_PASSWORD_HASH"]);
        for (const result of body.results) {
            if ("message" in result) expect(result.message).not.toMatch(/hunter2|aaaa/);
        }
        expect([...store.users.values()].map(u => [u.email, u.passwordHash])).toEqual([
            ["fine@example.com", BCRYPT],
            ["none@example.com", null]
        ]);
    });

    it("refuses an algorithm it does not know, and other spellings of the hash", async () => {
        const { importUsers } = world();

        const unknown = await importUsers({ passwordHashAlgorithm: "md5", users: [{ email: EMAIL, passwordHash: BCRYPT }] });
        expect(unknown.status).toBe(400);
        expect(unknown.body.error?.message).toMatch(/passwordHashAlgorithm` is one of bcrypt/);

        const { body } = await importUsers({
            passwordHashAlgorithm: "bcrypt",
            users: [{ email: "a@example.com", encrypted_password: BCRYPT }, { email: "b@example.com", password: PASSWORD }]
        });
        expect(body).toMatchObject({ created: 0, failed: 2 });
        expect(body.results[0]).toMatchObject({ message: expect.stringMatching(/Send the hash as `passwordHash`/) });
        expect(body.results[1]).toMatchObject({ message: expect.stringMatching(/`password` is not imported/) });
    });

    it("writes nothing with dryRun, and still checks the hashes", async () => {
        const { store, importUsers } = world();

        const { body } = await importUsers({
            dryRun: true,
            passwordHashAlgorithm: "bcrypt",
            users: [{ email: EMAIL, passwordHash: BCRYPT }, { email: "bad@example.com", passwordHash: "nope" }]
        });

        expect(body).toMatchObject({ dryRun: true, created: 1, failed: 1 });
        expect(store.users.size).toBe(0);
    });
});

describe("importedPasswordHashProblem", () => {
    it.each([BCRYPT, BCRYPT_2A, BCRYPT.replace(/^\$2b\$/, "$2y$")])("takes %s", (hash) => {
        expect(importedPasswordHashProblem(hash, "bcrypt")).toBeUndefined();
    });

    it.each([
        ["", /not a bcrypt hash/],
        ["$2x$10$" + "a".repeat(53), /not a bcrypt hash/],
        ["$2b$10$" + "a".repeat(52), /not a bcrypt hash/],
        ["$2b$03$" + "a".repeat(53), /cost of 3/],
        ["$2b$32$" + "a".repeat(53), /cost of 32/],
        [null, /not a string/]
    ])("refuses %j", (hash, problem) => {
        expect(importedPasswordHashProblem(hash, "bcrypt")).toMatch(problem);
    });
});
