/**
 * An account imported with its old id signs in, as that id.
 *
 * The Triptelier migration inserted its Supabase users into `rebase.users` by
 * SQL, keeping their uuids so every `owner_id` still matched; whether such a
 * row could sign in was never tried. Here the import goes through
 * `POST /admin/users/import`, and the account then completes a magic link and
 * a password reset against the real auth routes and a real Postgres (PGlite):
 * the session it gets carries the imported id.
 *
 * And against a users table keyed by `uuid`: an id the column cannot hold is
 * one account's failure with a reason, not a 500, and looking it up finds
 * nobody rather than throwing.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { Hono } from "hono";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { ImportUsersResult } from "@rebasepro/types";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";
import { createAdminUsersRoute } from "../../server/src/auth/admin-users-route";
import { createAuthRoutes } from "../../server/src/auth/routes";
import { configureJwt } from "../../server/src/auth/jwt";
import { errorHandler } from "../../server/src/api/errors";
import type { HonoEnv } from "../../server/src/api/types";
import type { EmailSendOptions } from "../../server/src/email";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { PostgresAuthRepository, UserService } from "../src/auth/services";

const SERVICE_KEY = "imported-user-sign-in-service-key-0123456789";
const SUPABASE_ID = "5b0a3c9e-21f4-4d3b-8a6e-7c1d2e3f4a5b";

/** What an auth route answers on success. */
interface Session {
    user?: { uid: string; email: string; emailVerified: boolean };
    tokens?: { accessToken: string };
    error?: { code: string; message: string };
}

describe("an imported account signs in under its imported id", () => {
    let pglite: PGlite;
    let db: NodePgDatabase;
    const mails: EmailSendOptions[] = [];
    let app: Hono<HonoEnv>;

    const post = async <T>(path: string, body: unknown, bearer?: string): Promise<{ status: number; json: T }> => {
        const res = await app.request(path, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
            body: JSON.stringify(body)
        });
        return { status: res.status, json: await res.json() as T };
    };

    /** The token in the last mail sent to `to`. */
    const mailedToken = async (to: string): Promise<string> => {
        await new Promise(resolve => setImmediate(resolve));
        const mail = [...mails].reverse().find(m => m.to === to && /token=/.test(m.text ?? ""));
        const match = mail ? /token=([A-Za-z0-9_-]+)/.exec(mail.text ?? "") : null;
        if (!match) throw new Error(`no link was mailed to ${to}`);
        return match[1];
    };

    beforeAll(async () => {
        configureJwt({ secret: "imported-user-sign-in-secret-0123456789abcdef", accessExpiresIn: "1h" });
        pglite = new PGlite();
        db = pgliteNodePg(pglite);
        await ensureAuthTablesExist(db);
        const repo = new PostgresAuthRepository(db);
        const emailService = {
            isConfigured: () => true,
            send: async (mail: EmailSendOptions) => { mails.push(mail); return { messageId: `m-${mails.length}` }; }
        };
        const emailConfig = { from: "noreply@app.test", appName: "App", resetPasswordUrl: "https://app.test" };
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/admin", createAdminUsersRoute({ authRepo: repo, serviceKey: SERVICE_KEY, emailService, emailConfig }));
        app.route("/auth", createAuthRoutes({ authRepo: repo, enableMagicLink: true, emailService, emailConfig }));
    });

    afterAll(async () => {
        await pglite.close();
    });

    it("imports the row with its id, no password, and sends nothing", async () => {
        const { status, json } = await post<ImportUsersResult>("/admin/users/import", {
            users: [
                { id: SUPABASE_ID, email: "Agency@Triptelier.test", createdAt: "2024-05-02T08:30:00.000Z", emailVerified: true, roles: ["agency"] },
                { id: "c0ffee00-0000-4000-8000-000000000001", email: "reset@triptelier.test" }
            ]
        }, SERVICE_KEY);

        expect(status).toBe(200);
        expect(json).toMatchObject({ created: 2, skipped: 0, failed: 0 });
        const { rows } = await pglite.query<{ id: string; email: string; password_hash: string | null; email_verified: boolean; roles: string[]; created_at: Date }>(
            "SELECT id, email, password_hash, email_verified, roles, created_at FROM rebase.users WHERE id = $1", [SUPABASE_ID]
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ email: "agency@triptelier.test", password_hash: null, email_verified: true, roles: ["agency"] });
        expect(new Date(rows[0].created_at).toISOString()).toBe("2024-05-02T08:30:00.000Z");
        expect(mails).toEqual([]);

        // Run again: everything is skipped, nothing is touched.
        const again = await post<ImportUsersResult>("/admin/users/import", {
            users: [{ id: SUPABASE_ID, email: "agency@triptelier.test", displayName: "Changed" }]
        }, SERVICE_KEY);
        expect(again.json).toMatchObject({ created: 0, skipped: 1 });
        const { rows: after } = await pglite.query<{ display_name: string | null }>("SELECT display_name FROM rebase.users WHERE id = $1", [SUPABASE_ID]);
        expect(after[0].display_name).toBeNull();
    });

    it("completes a magic link, and the session is the imported id's", async () => {
        expect((await post("/auth/magic-link", { email: "agency@triptelier.test" })).status).toBe(200);

        const signedIn = await post<Session>("/auth/magic-link/verify", { token: await mailedToken("agency@triptelier.test") });

        expect(signedIn.status).toBe(200);
        expect(signedIn.json.user).toMatchObject({ uid: SUPABASE_ID, email: "agency@triptelier.test", emailVerified: true });
        expect(signedIn.json.user && "roles" in signedIn.json.user ? signedIn.json.user.roles : undefined).toEqual(["agency"]);
        const { rows } = await pglite.query<{ n: number }>("SELECT count(*)::int AS n FROM rebase.refresh_tokens WHERE uid = $1", [SUPABASE_ID]);
        expect(rows[0].n).toBe(1);
    });

    it("completes a password reset, then signs in with that password", async () => {
        const email = "reset@triptelier.test";
        expect((await post("/auth/forgot-password", { email })).status).toBe(200);
        const reset = await post<Session>("/auth/reset-password", { token: await mailedToken(email), password: "A-new-passw0rd-for-reset" });
        expect(reset.status).toBe(200);

        const login = await post<Session>("/auth/login", { email, password: "A-new-passw0rd-for-reset" });

        expect(login.status).toBe(200);
        expect(login.json.user?.uid).toBe("c0ffee00-0000-4000-8000-000000000001");
    });
});

describe("a users table keyed by uuid", () => {
    let pglite: PGlite;
    let service: UserService;
    let app: Hono<HonoEnv>;

    beforeAll(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        // A project's own users table, keyed by uuid; the boot adds the
        // columns auth needs and keys every auth table's `uid` the same way.
        await pglite.exec(`
            CREATE SCHEMA rebase;
            CREATE TABLE rebase.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE);
        `);
        const db = pgliteNodePg(pglite);
        await ensureAuthTablesExist(db);
        service = new UserService(db);
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/admin", createAdminUsersRoute({ authRepo: new PostgresAuthRepository(db), serviceKey: SERVICE_KEY }));
    });

    afterAll(async () => {
        await pglite.close();
    });

    it("refuses an id the column cannot hold, for that account only", async () => {
        const res = await app.request("/admin/users/import", {
            method: "POST",
            headers: { "Content-Type": "application/json", authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ users: [{ id: "firebase-uid-123", email: "fb@example.test" }, { id: SUPABASE_ID, email: "sb@example.test" }] })
        });
        const json = await res.json() as ImportUsersResult;

        expect(res.status).toBe(200);
        expect(json.results.map(r => r.status)).toEqual(["failed", "created"]);
        expect(json.results[0]).toMatchObject({ code: "INVALID_ID", uid: "firebase-uid-123" });
    });

    it("finds nobody for such an id, rather than throwing", async () => {
        expect(await service.getUserById("firebase-uid-123")).toBeNull();
    });

    it("answers a taken id with ID_EXISTS, and a taken email with EMAIL_EXISTS", async () => {
        await expect(service.createUser({ id: SUPABASE_ID, email: "another@example.test" })).rejects.toMatchObject({ statusCode: 409, code: "ID_EXISTS" });
        await expect(service.createUser({ email: "sb@example.test" })).rejects.toMatchObject({ statusCode: 409, code: "EMAIL_EXISTS" });
    });
});
