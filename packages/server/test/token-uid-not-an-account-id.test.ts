import { beforeAll, describe, expect, it } from "@jest/globals";
import { Hono } from "hono";

import type { HonoEnv } from "../src/api/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createRequireAuth } from "../src/auth/middleware";
import { judgeAccessToken, type AccessJudgeRepository } from "../src/auth/token-revocation";

/**
 * A verified access token whose uid the account table cannot hold.
 *
 * `generateAccessToken("u1", ["editor"])` signs a perfectly good token, and
 * the built-in auth then asks Postgres for account `u1` against a UUID key.
 * Postgres refuses the value (`invalid input syntax for type uuid`), the judge
 * threw, and every door answered 503 ROLE_LOOKUP_FAILED, "Please try again" —
 * a retryable outage for a request that can never succeed. A UUID nobody has
 * already answered 401, and `u1` names no account in exactly the same way.
 */

/** What node-postgres raises for `'u1'::uuid`: SQLSTATE 22P02, a data exception. */
const invalidUuid = (uid: string): Error =>
    Object.assign(new Error(`invalid input syntax for type uuid: "${uid}"`), { code: "22P02" });

/** An account store keyed by UUID, as `rebase.users` is. */
const uuidKeyedRepo: AccessJudgeRepository = {
    getAccountAccessState: async (uid) => {
        if (!/^[0-9a-f-]{36}$/i.test(uid)) throw invalidUuid(uid);
        return null;
    }
};

describe("judgeAccessToken", () => {
    it("reads a uid the id column cannot hold as an account that does not exist", async () => {
        await expect(judgeAccessToken(uuidKeyedRepo, { uid: "u1" }))
            .resolves.toEqual({ live: false, refusal: "account-deleted" });
    });

    it("answers it exactly as it answers a UUID nobody has", async () => {
        await expect(judgeAccessToken(uuidKeyedRepo, { uid: "7f27459f-2b8c-4c4e-9a51-0d8f3b1e6a10" }))
            .resolves.toEqual({ live: false, refusal: "account-deleted" });
    });

    it("still throws when the store itself fails, so the request is refused rather than guessed", async () => {
        const down: AccessJudgeRepository = {
            getAccountAccessState: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); }
        };
        await expect(judgeAccessToken(down, { uid: "u1" })).rejects.toThrow("ECONNREFUSED");
    });

    it("reads the same answer through the older two-read repository shape", async () => {
        const older: AccessJudgeRepository = {
            getUserWithRoles: async (uid) => { throw invalidUuid(uid); }
        };
        await expect(judgeAccessToken(older, { uid: "u1" }))
            .resolves.toEqual({ live: false, refusal: "account-deleted" });
    });
});

describe("an admin-gated route, given a token minted for a non-UUID uid", () => {
    beforeAll(() => {
        configureJwt({ secret: "token-uid-not-an-account-id-secret-0123456789" });
    });

    it("answers 401 naming the account, not 503 asking to try again", async () => {
        const app = new Hono<HonoEnv>();
        app.use("/*", createRequireAuth({ revocationRepo: uuidKeyedRepo, resolveRoles: async () => ["editor"] }));
        app.get("/admin/thing", (c) => c.json({ ok: true }));

        const token = await generateAccessToken("u1", ["editor"]);
        const res = await app.request("/admin/thing", { headers: { Authorization: `Bearer ${token}` } });

        expect(res.status).toBe(401);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).not.toBe("ROLE_LOOKUP_FAILED");
        expect(body.error.message).toMatch(/account/i);
    });
});
