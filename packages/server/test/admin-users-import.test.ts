/**
 * `POST /admin/users/import`: accounts from another system, keeping their ids.
 *
 * Moving an app from Supabase meant inserting into `rebase.users` by SQL, so
 * the uuids every `owner_id` pointed at survived; `rebase users create` could
 * not keep an id and emailed each account a set-password invitation, the
 * wrong mail for a magic-link app. The import keeps the id, sets no password,
 * sends nothing, and never updates an account it finds already there.
 */
import { describe, it, expect, beforeAll } from "@jest/globals";
import { Hono } from "hono";
import { MAX_USERS_PER_IMPORT, importedUserIdProblem, type ImportUsersResult } from "@rebasepro/types";
import type { EmailSendOptions, EmailService } from "../src/email";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";
import type { CreateUserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { MemoryAuthStore } from "./helpers/memory-auth-store";

const SERVICE_KEY = "admin-users-import-service-key-0123456789";
const SUPABASE_ID = "7f3c2a10-5b1e-4f7a-9a51-0d2a6b1c9e44";

beforeAll(() => configureJwt({ secret: "admin-users-import-secret-0123456789abcdef", accessExpiresIn: "1h" }));

function world(options: { beforeUserCreate?: (data: CreateUserData) => Promise<CreateUserData> } = {}) {
    const store = new MemoryAuthStore();
    const sent: EmailSendOptions[] = [];
    const emailService: EmailService = {
        isConfigured: () => true,
        send: async (mail) => { sent.push(mail); return { messageId: `m-${sent.length}` }; }
    };
    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.route("/", createAdminUsersRoute({
        authRepo: store.repo(),
        serviceKey: SERVICE_KEY,
        emailService,
        emailConfig: { from: "noreply@app.test", appName: "App", resetPasswordUrl: "https://app.test" },
        ...(options.beforeUserCreate ? { authHooks: { beforeUserCreate: options.beforeUserCreate } } : {})
    }));
    const post = async (body: unknown, bearer = SERVICE_KEY) => {
        const res = await app.request("/users/import", {
            method: "POST",
            headers: { authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });
        return { status: res.status, body: await res.json() as ImportUsersResult & { error?: { code: string; message: string } } };
    };
    return { store, sent, post };
}

describe("POST /users/import", () => {
    it("keeps the id, the date and the verification, sets no password and sends nothing", async () => {
        const { store, sent, post } = world();

        const { status, body } = await post({
            users: [
                { id: SUPABASE_ID, email: "Agency@Example.com", displayName: "Agency", createdAt: "2024-03-01T10:00:00.000Z", emailVerified: true, roles: ["editor"] },
                { email: "second@example.com" }
            ]
        });

        expect(status).toBe(200);
        expect(body).toMatchObject({ dryRun: false, created: 2, skipped: 0, failed: 0 });
        expect(body.results[0]).toEqual({ index: 0, status: "created", uid: SUPABASE_ID, email: "agency@example.com" });
        const kept = store.users.get(SUPABASE_ID);
        expect(kept).toMatchObject({
            email: "agency@example.com",
            displayName: "Agency",
            emailVerified: true,
            passwordHash: null,
            createdAt: new Date("2024-03-01T10:00:00.000Z")
        });
        expect(store.roles.get(SUPABASE_ID)).toEqual(["editor"]);
        // The second got a generated id, and is unverified unless the file says so.
        const second = [...store.users.values()].find(u => u.email === "second@example.com");
        expect(second?.id).toBe(body.results[1].uid);
        expect(second?.emailVerified).toBe(false);
        expect(sent).toEqual([]);
        expect(store.resetTokens.size).toBe(0);
    });

    it("skips an account whose id or email is taken, and leaves it as it is", async () => {
        const { store, post } = world();
        await post({ users: [{ id: SUPABASE_ID, email: "first@example.com", displayName: "Before" }] });

        const { body } = await post({
            users: [
                { id: SUPABASE_ID, email: "other@example.com", displayName: "After" },
                { email: "FIRST@example.com", displayName: "After" },
                { id: "dup-1", email: "twice@example.com" },
                { id: "dup-2", email: "twice@example.com" }
            ]
        });

        expect(body).toMatchObject({ created: 1, skipped: 3, failed: 0 });
        expect(body.results.map(r => [r.status, "code" in r ? r.code : undefined])).toEqual([
            ["skipped", "ID_EXISTS"],
            ["skipped", "EMAIL_EXISTS"],
            ["created", undefined],
            ["skipped", "EMAIL_EXISTS"]
        ]);
        expect(store.users.get(SUPABASE_ID)?.displayName).toBe("Before");
        expect(store.users.has("dup-2")).toBe(false);
    });

    it("fails one bad account and imports the rest, saying why", async () => {
        const { store, post } = world();

        const { status, body } = await post({
            users: [
                { email: "not-an-address" },
                { id: "a/b", email: "slash@example.com" },
                { id: "service", email: "service@example.com" },
                { email: "pw@example.com", password: "hunter2hunter2" },
                { email: "extra@example.com", phone: "+1" },
                { email: "date@example.com", createdAt: "yesterday-ish" },
                { email: "roles@example.com", roles: ["a,b"] },
                { email: "fine@example.com" }
            ]
        });

        expect(status).toBe(200);
        expect(body).toMatchObject({ created: 1, skipped: 0, failed: 7 });
        expect(body.results.map(r => ("code" in r ? r.code : r.status))).toEqual([
            "INVALID_INPUT", "INVALID_ID", "INVALID_ID", "INVALID_INPUT", "INVALID_INPUT", "INVALID_INPUT", "INVALID_ROLE", "created"
        ]);
        const messages = body.results.map(r => ("message" in r ? r.message : ""));
        expect(messages[3]).toMatch(/has no password/);
        expect(messages[4]).toMatch(/Unknown field `phone`/);
        expect([...store.users.values()].map(u => u.email)).toEqual(["fine@example.com"]);
    });

    it("writes nothing with dryRun, and reports what it would do", async () => {
        const { store, post } = world();
        await post({ users: [{ email: "taken@example.com" }] });

        const { body } = await post({
            dryRun: true,
            users: [{ id: SUPABASE_ID, email: "new@example.com" }, { email: "taken@example.com" }, { email: "new@example.com" }]
        });

        expect(body).toMatchObject({ dryRun: true, created: 1, skipped: 2, failed: 0 });
        expect(store.users.size).toBe(1);
    });

    it("runs beforeUserCreate, which may refuse one account, and keeps the id through it", async () => {
        const { store, post } = world({
            beforeUserCreate: async (data) => {
                if (data.email.endsWith("@blocked.test")) throw new Error("not this domain");
                // A hook written before ids could be kept rebuilds the object.
                return { email: data.email, displayName: "hooked", emailVerified: data.emailVerified };
            }
        });

        const { body } = await post({ users: [{ id: SUPABASE_ID, email: "ok@example.com" }, { email: "x@blocked.test" }] });

        expect(body.results.map(r => r.status)).toEqual(["created", "failed"]);
        expect(body.results[1]).toMatchObject({ code: "HOOK_REJECTED", message: "not this domain" });
        expect(store.users.get(SUPABASE_ID)?.displayName).toBe("hooked");
    });

    it("refuses a request over the batch size, and one with no users", async () => {
        const { post } = world();
        const many = Array.from({ length: MAX_USERS_PER_IMPORT + 1 }, (_, i) => ({ email: `u${i}@example.com` }));

        const tooMany = await post({ users: many });
        expect(tooMany.status).toBe(400);
        expect(tooMany.body.error?.code).toBe("TOO_MANY_USERS");
        expect((await post({ users: [] })).status).toBe(400);
        expect((await post({ accounts: [] })).status).toBe(400);
    });

    it("is held to users:write, as the other user routes are", async () => {
        const { store, post } = world();
        await store.repo().createUser({ id: "editor-1", email: "editor@example.com" });
        await store.repo().setUserRoles("editor-1", ["editor"]);

        const editor = await post({ users: [{ email: "x@example.com" }] }, await generateAccessToken("editor-1", ["editor"]));

        expect(editor.status).toBe(403);
        expect(editor.body.error?.code).toBe("SCOPE_MISSING");
        expect([...store.users.keys()]).toEqual(["editor-1"]);
    });
});

describe("importedUserIdProblem", () => {
    it.each([
        SUPABASE_ID,
        "Xy3kq9TzR4bW0aLmN8cDe2fGh5Ij", // a Firebase uid
        "auth0|5f7c8ec7c33c6c004bbafe82",
        "user_2abcDEF",
        "a".repeat(128)
    ])("keeps %s", (id) => {
        expect(importedUserIdProblem(id)).toBeUndefined();
    });

    it.each([
        ["", /empty/],
        ["a".repeat(129), /longer than 128/],
        ["a/b", /may hold only/],
        ["bob@example.com", /may hold only/],
        [" lead", /may hold only/],
        ["-lead", /may hold only/],
        ["Service", /reserved/],
        ["anonymous", /reserved/],
        [42, /not a string/]
    ])("refuses %j", (id, problem) => {
        expect(importedUserIdProblem(id)).toMatch(problem);
    });
});
