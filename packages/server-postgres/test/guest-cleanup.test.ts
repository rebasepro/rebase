/**
 * Deleting guests, against a real Postgres (PGlite) through the real admin
 * route: which rows the database calls a guest is the thing under test, so a
 * mocked driver would prove nothing.
 *
 * The bulk door takes every guest it can reach. What matters is what it cannot:
 * an account, and the two rows that carry `is_anonymous` and are one anyway,
 * because they can sign back in.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createAdminUsersRoute } from "../../server/src/auth/admin-users-route";
import { ensureAuthTablesExist } from "../src/auth/ensure-tables";
import { PostgresAuthRepository, UserService } from "../src/auth/services";

const SERVICE_KEY = "guest-cleanup-service-key-0123456789abcdef";
const headers = { authorization: `Bearer ${SERVICE_KEY}` };
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

let pglite: PGlite;
let db: NodePgDatabase;
let repo: PostgresAuthRepository;
let app: ReturnType<typeof createAdminUsersRoute>;

/** Insert a row with this age. `is_anonymous` and the password are the test's to choose. */
async function insertUser(email: string, age: number, options: { anonymous?: boolean; password?: string } = {}): Promise<string> {
    const user = await new UserService(db).createUser({
        email,
        isAnonymous: options.anonymous ?? false,
        passwordHash: options.password
    });
    await pglite.query("UPDATE rebase.users SET created_at = $1 WHERE id = $2", [daysAgo(age).toISOString(), user.id]);
    return user.id;
}

async function insertToken(uid: string, age: number): Promise<void> {
    await pglite.query(
        "INSERT INTO rebase.refresh_tokens (uid, token_hash, expires_at, created_at) VALUES ($1, $2, $3, $4)",
        [uid, `hash-${uid}-${age}`, new Date(Date.now() + DAY).toISOString(), daysAgo(age).toISOString()]
    );
}

async function remainingEmails(): Promise<string[]> {
    const { rows } = await pglite.query<{ email: string }>("SELECT email FROM rebase.users ORDER BY email");
    return rows.map(row => row.email);
}

const bulkDelete = (cutoff: Date, offset = 0) => app.request(
    `/guests?lastSeenBefore=${encodeURIComponent(cutoff.toISOString())}&offset=${offset}`,
    { method: "DELETE", headers }
);

beforeAll(async () => {
    pglite = new PGlite();
    db = drizzle(pglite) as unknown as NodePgDatabase;
    await ensureAuthTablesExist(db);
    repo = new PostgresAuthRepository(db);
    app = createAdminUsersRoute({ authRepo: repo, serviceKey: SERVICE_KEY });
});

beforeEach(async () => {
    await pglite.exec(`
        DROP TABLE IF EXISTS public.scores, public.profiles, public.posts, public.notes;
        DELETE FROM rebase.users;
    `);
});

afterAll(async () => {
    await pglite.close();
});

describe("what is a guest", () => {
    it("is anonymous with no password and no linked identity", async () => {
        const guest = await insertUser("guest@anonymous.local", 40, { anonymous: true });
        const account = await insertUser("account@example.test", 40, { password: "hash" });
        const noPassword = await insertUser("oauth@example.test", 40);
        // An older runtime left the flag set on a guest that linked a provider.
        const linked = await insertUser("linked@example.test", 40, { anonymous: true });
        await repo.linkUserIdentity(linked, "google", "google-1");
        // Nothing keeps an administrator from setting a password on a guest's row.
        const withPassword = await insertUser("password@example.test", 40, { anonymous: true, password: "hash" });

        const { guests, total } = await repo.listGuests();
        expect(guests.map(g => g.id)).toEqual([guest]);
        expect(total).toBe(1);

        for (const id of [account, noPassword, linked, withPassword]) {
            expect(await repo.deleteGuest(id)).toBe(false);
        }
        expect(await remainingEmails()).toEqual([
            "account@example.test", "guest@anonymous.local", "linked@example.test", "oauth@example.test", "password@example.test"
        ]);
    });
});

describe("last seen", () => {
    it("is the newest refresh token, and the creation of a guest with none", async () => {
        const gone = await insertUser("gone@anonymous.local", 40, { anonymous: true });
        const returning = await insertUser("returning@anonymous.local", 40, { anonymous: true });
        await insertToken(returning, 39);
        await insertToken(returning, 2);

        const { guests } = await repo.listGuests();
        expect(guests.map(g => g.id)).toEqual([gone, returning]);
        expect(guests[1].createdAt.getTime()).toBeLessThan(daysAgo(39).getTime());
        expect(Math.abs(guests[1].lastSeenAt.getTime() - daysAgo(2).getTime())).toBeLessThan(60_000);
        expect(guests[0].lastSeenAt).toEqual(guests[0].createdAt);

        const older = await repo.listGuests({ lastSeenBefore: daysAgo(30) });
        expect(older.guests.map(g => g.id)).toEqual([gone]);
        expect(older.total).toBe(1);
    });
});

describe("GET /guests", () => {
    it("pages the list, and `total` counts what DELETE would take", async () => {
        await insertUser("old-1@anonymous.local", 40, { anonymous: true });
        await insertUser("old-2@anonymous.local", 35, { anonymous: true });
        await insertUser("new@anonymous.local", 1, { anonymous: true });

        const everyone = await app.request("/guests?limit=1", { headers });
        const body = await everyone.json() as { guests: Array<Record<string, unknown>>; total: number };
        expect(everyone.status).toBe(200);
        expect(body.total).toBe(3);
        expect(body.guests).toHaveLength(1);
        expect(Object.keys(body.guests[0]).sort()).toEqual(["createdAt", "lastSeenAt", "uid"]);

        const cutoff = encodeURIComponent(daysAgo(30).toISOString());
        const old = await app.request(`/guests?lastSeenBefore=${cutoff}`, { headers });
        expect((await old.json() as { total: number }).total).toBe(2);
    });
});

describe("DELETE /guests", () => {
    it("takes every old guest and cannot reach an account", async () => {
        await insertUser("guest-1@anonymous.local", 40, { anonymous: true });
        await insertUser("guest-2@anonymous.local", 40, { anonymous: true });
        await insertUser("admin@example.test", 40, { password: "hash" });
        await insertUser("oauth@example.test", 40);
        const linked = await insertUser("linked@example.test", 40, { anonymous: true });
        await repo.linkUserIdentity(linked, "google", "google-1");
        await insertUser("password@example.test", 40, { anonymous: true, password: "hash" });

        // A cutoff past every row: the widest this door can be asked to be.
        const res = await bulkDelete(new Date(Date.now() - 1000));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ deleted: 2, skipped: [], remaining: 0 });
        expect(await remainingEmails()).toEqual([
            "admin@example.test", "linked@example.test", "oauth@example.test", "password@example.test"
        ]);
    });

    it("leaves a guest who has been seen since the cutoff", async () => {
        await insertUser("gone@anonymous.local", 40, { anonymous: true });
        const returning = await insertUser("returning@anonymous.local", 40, { anonymous: true });
        await insertToken(returning, 1);

        await bulkDelete(daysAgo(30));

        expect(await remainingEmails()).toEqual(["returning@anonymous.local"]);
    });

    it("leaves a guest who became an account after being listed", async () => {
        const guest = await insertUser("guest@anonymous.local", 40, { anonymous: true });
        const listed = await repo.listGuests();
        await repo.updateUser(guest, { email: "person@example.test", passwordHash: "hash", isAnonymous: false });

        expect(await repo.deleteGuest(listed.guests[0].id)).toBe(false);
        expect(await remainingEmails()).toEqual(["person@example.test"]);
    });

    it("ends a deleted guest's sessions, by the cascade", async () => {
        const guest = await insertUser("guest@anonymous.local", 40, { anonymous: true });
        await insertToken(guest, 39);

        await bulkDelete(daysAgo(30));

        const { rows } = await pglite.query<{ count: number }>(
            "SELECT count(*)::int AS count FROM rebase.refresh_tokens WHERE uid = $1", [guest]
        );
        expect(rows[0].count).toBe(0);
    });

    /**
     * The project's own tables keep their own rules, which are not this door's
     * to override: a required link, RESTRICT by default, keeps the guest.
     */
    it("follows what the project's foreign keys say", async () => {
        const held = await insertUser("held@anonymous.local", 40, { anonymous: true });
        const cascaded = await insertUser("cascaded@anonymous.local", 41, { anonymous: true });
        const nulled = await insertUser("nulled@anonymous.local", 42, { anonymous: true });
        const dangling = await insertUser("dangling@anonymous.local", 43, { anonymous: true });
        await pglite.exec(`
            CREATE TABLE public.scores (owner text NOT NULL REFERENCES rebase.users(id) ON DELETE RESTRICT);
            CREATE TABLE public.profiles (owner text NOT NULL REFERENCES rebase.users(id) ON DELETE CASCADE);
            CREATE TABLE public.posts (owner text REFERENCES rebase.users(id) ON DELETE SET NULL);
            CREATE TABLE public.notes (owner text);
        `);
        await pglite.query("INSERT INTO public.scores VALUES ($1)", [held]);
        await pglite.query("INSERT INTO public.profiles VALUES ($1)", [cascaded]);
        await pglite.query("INSERT INTO public.posts VALUES ($1)", [nulled]);
        await pglite.query("INSERT INTO public.notes VALUES ($1)", [dangling]);

        const res = await bulkDelete(daysAgo(30));

        expect(await res.json()).toEqual({
            deleted: 3,
            skipped: [{ uid: held, code: "GUEST_REFERENCED", message: expect.any(String) }],
            remaining: 0
        });
        expect(await remainingEmails()).toEqual(["held@anonymous.local"]);
        expect((await pglite.query("SELECT 1 FROM public.scores")).rows).toHaveLength(1);
        expect((await pglite.query("SELECT 1 FROM public.profiles")).rows).toHaveLength(0);
        expect((await pglite.query("SELECT owner FROM public.posts")).rows).toEqual([{ owner: null }]);
        expect((await pglite.query("SELECT owner FROM public.notes")).rows).toEqual([{ owner: dangling }]);
    });

    it.each(["ON DELETE RESTRICT", "ON DELETE NO ACTION"])("answers GUEST_REFERENCED by id too, for %s", async (rule) => {
        const held = await insertUser("held@anonymous.local", 40, { anonymous: true });
        await pglite.exec(`CREATE TABLE public.scores (owner text NOT NULL REFERENCES rebase.users(id) ${rule})`);
        await pglite.query("INSERT INTO public.scores VALUES ($1)", [held]);

        const res = await app.request(`/guests/${held}`, { method: "DELETE", headers });

        expect(res.status).toBe(409);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("GUEST_REFERENCED");
    });
});

describe("DELETE /guests/:uid", () => {
    it("deletes a guest", async () => {
        const guest = await insertUser("guest@anonymous.local", 1, { anonymous: true });

        const res = await app.request(`/guests/${guest}`, { method: "DELETE", headers });

        expect(res.status).toBe(200);
        expect(await remainingEmails()).toEqual([]);
    });

    it("refuses an account", async () => {
        const account = await insertUser("account@example.test", 40, { password: "hash" });

        const res = await app.request(`/guests/${account}`, { method: "DELETE", headers });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("NOT_ANONYMOUS");
        expect(await remainingEmails()).toEqual(["account@example.test"]);
    });

    it("refuses a row that carries the flag and can still sign in", async () => {
        const linked = await insertUser("linked@example.test", 40, { anonymous: true });
        await repo.linkUserIdentity(linked, "google", "google-1");

        const res = await app.request(`/guests/${linked}`, { method: "DELETE", headers });

        expect(res.status).toBe(400);
        expect(await remainingEmails()).toEqual(["linked@example.test"]);
    });
});
