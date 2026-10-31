/**
 * The admin guest routes' gates, hooks and batching, over a stand-in repository.
 * What a guest is, in SQL, is `server-postgres/test/guest-cleanup.test.ts`.
 */
import { describe, it, expect, beforeAll, jest } from "@jest/globals";
import { createAdminUsersRoute } from "../src/auth/admin-users-route";
import type { AuthRepository, ListGuestsOptions, UserData } from "../src/auth/interfaces";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";

const TEST_SECRET = "test-secret-key-for-admin-guests-1234567890";
const PAST = "2026-01-01T00:00:00.000Z";

function guestRow(id: string) {
    return { id, createdAt: new Date(PAST), lastSeenAt: new Date(PAST) };
}

function mockRepo(ids: string[], total = ids.length, callerRoles = ["admin"]) {
    const listGuests = jest.fn(async (_options: ListGuestsOptions) => ({ guests: ids.map(guestRow), total }));
    const deleteGuest = jest.fn(async (_id: string) => true);
    const deleteUser = jest.fn(async () => undefined);
    const deleteAllRefreshTokensForUser = jest.fn(async () => undefined);
    const repo = {
        listGuests,
        deleteGuest,
        deleteUser,
        deleteAllRefreshTokensForUser,
        getUserById: async (id: string) => ({ id, email: `${id}@x`, isAnonymous: id.startsWith("guest") }) as UserData,
        // The route reads roles from the store, not the token.
        getUserRoleIds: async (id: string) => (id === "caller" ? callerRoles : []),
        listUsersPaginated: async () => ({ users: [], total: 1, limit: 1, offset: 0 })
    } as unknown as AuthRepository;
    return { repo, listGuests, deleteGuest, deleteUser, deleteAllRefreshTokensForUser };
}

async function bearer(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await generateAccessToken("caller", ["admin"])}` };
}

describe("admin guest routes", () => {
    beforeAll(() => {
        configureJwt({ secret: TEST_SECRET, accessExpiresIn: "1h" });
    });

    it("are for administrators", async () => {
        const { repo, deleteGuest } = mockRepo(["guest-1"], 1, ["member"]);
        const app = createAdminUsersRoute({ authRepo: repo });
        const member = await bearer();

        expect((await app.request("/guests", { headers: member })).status).toBe(403);
        expect((await app.request(`/guests?lastSeenBefore=${PAST}`, { method: "DELETE", headers: member })).status).toBe(403);
        expect((await app.request("/guests/guest-1", { method: "DELETE", headers: member })).status).toBe(403);
        expect((await app.request("/guests")).status).toBe(401);
        expect(deleteGuest).not.toHaveBeenCalled();
    });

    it("answer 501 on a repository without guests", async () => {
        const { repo } = mockRepo([]);
        const app = createAdminUsersRoute({ authRepo: { ...repo, listGuests: undefined, deleteGuest: undefined } });

        const res = await app.request("/guests", { headers: await bearer() });

        expect(res.status).toBe(501);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("NOT_SUPPORTED");
    });

    it.each([
        ["no date", ""],
        ["an unreadable date", "?lastSeenBefore=soon"],
        ["a date in the future, which would be every guest", "?lastSeenBefore=2999-01-01T00:00:00.000Z"]
    ])("refuse a bulk delete with %s", async (_what, query) => {
        const { repo, listGuests, deleteGuest } = mockRepo(["guest-1"]);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request(`/guests${query}`, { method: "DELETE", headers: await bearer() });

        expect(res.status).toBe(400);
        expect(listGuests).not.toHaveBeenCalled();
        expect(deleteGuest).not.toHaveBeenCalled();
    });

    it("delete a batch through `deleteGuest`, never `deleteUser`, and say what is left", async () => {
        const { repo, listGuests, deleteGuest, deleteUser, deleteAllRefreshTokensForUser } = mockRepo(["guest-1", "guest-2"], 7);
        const afterUserDelete = jest.fn(async () => undefined);
        const app = createAdminUsersRoute({ authRepo: repo, authHooks: { afterUserDelete } });

        const res = await app.request(`/guests?lastSeenBefore=${PAST}&offset=1`, { method: "DELETE", headers: await bearer() });

        expect(await res.json()).toEqual({ deleted: 2, skipped: [], remaining: 4 });
        expect(listGuests).toHaveBeenCalledWith({ limit: 200, offset: 1, lastSeenBefore: new Date(PAST) });
        expect(deleteGuest.mock.calls).toEqual([["guest-1"], ["guest-2"]]);
        expect(deleteUser).not.toHaveBeenCalled();
        expect(deleteAllRefreshTokensForUser.mock.calls).toEqual([["guest-1"], ["guest-2"]]);
        expect(afterUserDelete).toHaveBeenCalledTimes(2);
    });

    it("keep a row `deleteGuest` turned down, its sessions untouched", async () => {
        const { repo, deleteGuest, deleteAllRefreshTokensForUser } = mockRepo(["guest-1"]);
        deleteGuest.mockResolvedValue(false);
        const afterUserDelete = jest.fn(async () => undefined);
        const app = createAdminUsersRoute({ authRepo: repo, authHooks: { afterUserDelete } });

        const res = await app.request(`/guests?lastSeenBefore=${PAST}`, { method: "DELETE", headers: await bearer() });

        expect(await res.json()).toEqual({ deleted: 0, skipped: [], remaining: 0 });
        expect(deleteAllRefreshTokensForUser).not.toHaveBeenCalled();
        expect(afterUserDelete).not.toHaveBeenCalled();
    });

    it("report a guest `beforeUserDelete` vetoed, and go on to the next", async () => {
        const { repo, deleteGuest } = mockRepo(["guest-1", "guest-2"]);
        const beforeUserDelete = jest.fn(async (uid: string) => {
            if (uid === "guest-1") throw new Error("holds an open order");
        });
        const app = createAdminUsersRoute({ authRepo: repo, authHooks: { beforeUserDelete } });

        const res = await app.request(`/guests?lastSeenBefore=${PAST}`, { method: "DELETE", headers: await bearer() });

        expect(await res.json()).toEqual({
            deleted: 1,
            skipped: [{ uid: "guest-1", code: "HOOK_REJECTED", message: expect.any(String) }],
            remaining: 0
        });
        expect(deleteGuest.mock.calls).toEqual([["guest-2"]]);
    });

    it("refuse an account by id, before any hook", async () => {
        const { repo, deleteGuest } = mockRepo([]);
        const beforeUserDelete = jest.fn(async () => undefined);
        const app = createAdminUsersRoute({ authRepo: repo, authHooks: { beforeUserDelete } });

        const res = await app.request("/guests/account-1", { method: "DELETE", headers: await bearer() });

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("NOT_ANONYMOUS");
        expect(beforeUserDelete).not.toHaveBeenCalled();
        expect(deleteGuest).not.toHaveBeenCalled();
    });

    it("say so when a guest became an account between the read and the delete", async () => {
        const { repo, deleteGuest } = mockRepo([]);
        deleteGuest.mockResolvedValue(false);
        const app = createAdminUsersRoute({ authRepo: repo });

        const res = await app.request("/guests/guest-1", { method: "DELETE", headers: await bearer() });

        expect(res.status).toBe(400);
    });
});
