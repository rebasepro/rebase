/**
 * A rotation writes its token only while the token it replaces is live.
 *
 * `POST /auth/refresh` reads the presented token, checks it, does several
 * round trips of work (roles, the user, a claims hook, signing), and only then
 * writes the rotated token into the same session. A sign-out landing in that
 * window revoked every row of the session — and the refresh then inserted its
 * new row with `revoked = false`. In cookie mode the response re-set the
 * cookie, so the sign-out silently did not happen. Password reset closes the
 * same window with the revocation mark; logout and device revoke had nothing.
 *
 * So the write is conditional on the parent, decided in the database: the
 * parent row is share-locked and must be present and unrevoked, or nothing is
 * written and the caller hears `false`. `revokeSession` locks the session's
 * rows before it writes, so a rotation holding its parent finishes first and
 * the revocation's own write — a fresh statement — sees the row it minted.
 *
 * On PGlite: a real Postgres, so the SQL is what is under test. It is one
 * connection, so the interleaving itself is not; the ordering argument is in
 * `RefreshTokenService.revokeSession`.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { RefreshTokenService, UserService } from "../src/auth/services";

let pglite: PGlite;
let tokens: RefreshTokenService;
let uid: string;

const future = () => new Date(Date.now() + 60 * 60 * 1000);

beforeAll(async () => {
    pglite = new PGlite();
    const db = drizzle(pglite) as unknown as NodePgDatabase;
    await ensureAuthTablesExist(db);
    uid = (await new UserService(db).createUser({ email: "rotation@example.test" })).id;
    tokens = new RefreshTokenService(db);
});

afterAll(async () => {
    await pglite.close();
});

describe("RefreshTokenService.createToken with rotatedFrom", () => {
    it("writes the rotated token while its parent is live", async () => {
        const session = { id: "s-live", startedAt: new Date() };
        await tokens.createToken(uid, "live-parent", future(), "ua", "ip", session);
        await tokens.markRotated("live-parent");

        const written = await tokens.createToken(uid, "live-child", future(), "ua", "ip", { ...session, rotatedFrom: "live-parent" });

        expect(written).toBe(true);
        expect(await tokens.findByHash("live-child")).toMatchObject({ sessionId: "s-live", revoked: false });
    });

    it("writes nothing once the session was signed out, and says so", async () => {
        const session = { id: "s-out", startedAt: new Date() };
        await tokens.createToken(uid, "out-parent", future(), "ua", "ip", session);
        await tokens.revokeSession("s-out");

        const written = await tokens.createToken(uid, "out-child", future(), "ua", "ip", { ...session, rotatedFrom: "out-parent" });

        expect(written).toBe(false);
        expect(await tokens.findByHash("out-child")).toBeNull();
    });

    it("writes nothing when the parent is gone", async () => {
        const session = { id: "s-gone", startedAt: new Date() };
        await tokens.createToken(uid, "gone-parent", future(), "ua", "ip", session);
        await tokens.deleteByHash("gone-parent");

        expect(await tokens.createToken(uid, "gone-child", future(), "ua", "ip", { ...session, rotatedFrom: "gone-parent" })).toBe(false);
        expect(await tokens.findByHash("gone-child")).toBeNull();
    });

    it("still revokes every row of the session, rotations included", async () => {
        const session = { id: "s-all", startedAt: new Date() };
        await tokens.createToken(uid, "all-parent", future(), "ua", "ip", session);
        await tokens.markRotated("all-parent");
        await tokens.createToken(uid, "all-child", future(), "ua", "ip", { ...session, rotatedFrom: "all-parent" });

        await tokens.revokeSession("s-all");

        expect(await tokens.findByHash("all-parent")).toMatchObject({ revoked: true });
        expect(await tokens.findByHash("all-child")).toMatchObject({ revoked: true });
    });
});
