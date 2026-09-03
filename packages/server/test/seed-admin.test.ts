import { describe, it, expect, jest } from "@jest/globals";
import { seedInitialAdmin } from "../src/auth/seed-admin";
import { logger } from "../src/utils/logger";
import type { UserManagementAdapter, AuthUserData } from "@rebasepro/types";

/**
 * Every fresh deployment has a window between "the database is empty" and "the
 * operator has registered", during which the first registration is promoted to
 * admin. The shipped artifacts bring DNS and TLS up before their operator has
 * typed anything, so on those the window is open to the internet and whoever
 * arrives first owns the deployment. Seeding the account from the environment
 * is what lets the artifacts close it.
 */
describe("seeding the initial admin from the environment", () => {
    function mockUsers(existing: AuthUserData[] = []) {
        const users = [...existing];
        const roles = new Map<string, string[]>();
        const adapter = {
            listUsers: jest.fn(async () => ({ users, total: users.length, limit: 1, offset: 0 })),
            getUserById: async (id: string) => users.find(u => u.id === id) ?? null,
            createUser: jest.fn(async (data: { email: string }) => {
                const user = { id: `u${users.length + 1}`, email: data.email } as AuthUserData;
                users.push(user);
                return user;
            }),
            updateUser: async () => null,
            deleteUser: async () => {},
            getUserRoles: async (uid: string) => roles.get(uid) ?? [],
            setUserRoles: jest.fn(async (uid: string, r: string[]) => { roles.set(uid, r); })
        } as unknown as UserManagementAdapter;
        return { adapter, roles, users };
    }

    const creds = { REBASE_ADMIN_EMAIL: "ops@acme.test", REBASE_ADMIN_PASSWORD: "a-long-enough-secret" };

    it("creates the admin on an empty user table", async () => {
        const { adapter, roles } = mockUsers();

        const outcome = await seedInitialAdmin(adapter, creds);

        expect(outcome).toEqual({ status: "created", uid: "u1" });
        expect(adapter.createUser).toHaveBeenCalledWith({
            email: "ops@acme.test",
            password: "a-long-enough-secret"
        });
        expect(roles.get("u1")).toEqual(["admin"]);
    });

    /**
     * "No users", not "no admin". A deployment with users has been bootstrapped,
     * and minting an admin into it from an environment variable would be a way
     * to take over a running system by editing a manifest.
     */
    it("does nothing once the deployment has users", async () => {
        const { adapter } = mockUsers([{ id: "existing", email: "someone@acme.test" } as AuthUserData]);

        const outcome = await seedInitialAdmin(adapter, creds);

        expect(outcome).toEqual({ status: "already-bootstrapped" });
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    it("warns at boot when production has no users and nothing named to seed", async () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        try {
            const { adapter } = mockUsers();
            const outcome = await seedInitialAdmin(adapter, { NODE_ENV: "production" });
            expect(outcome).toEqual({ status: "not-requested" });
            expect(adapter.listUsers).toHaveBeenCalled();
            expect(warn).toHaveBeenCalledWith(expect.stringContaining("REBASE_ADMIN_EMAIL"));
        } finally {
            warn.mockRestore();
        }
    });

    it("stays quiet in production once the deployment has users", async () => {
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        try {
            const { adapter } = mockUsers([{ id: "u1", email: "someone@acme.test" } as AuthUserData]);
            await seedInitialAdmin(adapter, { NODE_ENV: "production" });
            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
        }
    });

    it("does nothing when neither variable is set", async () => {
        const { adapter } = mockUsers();

        expect(await seedInitialAdmin(adapter, {})).toEqual({ status: "not-requested" });
        expect(adapter.listUsers).not.toHaveBeenCalled();
    });

    /** Half a credential is a typo, and the deployment it leaves has no way in. */
    it("refuses half a credential rather than guessing", async () => {
        const { adapter } = mockUsers();

        const outcome = await seedInitialAdmin(adapter, { REBASE_ADMIN_EMAIL: "ops@acme.test" });

        expect(outcome.status).toBe("skipped");
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    it("refuses a short password for an account that is admin on a live host", async () => {
        const { adapter } = mockUsers();

        const outcome = await seedInitialAdmin(adapter, {
            REBASE_ADMIN_EMAIL: "ops@acme.test",
            REBASE_ADMIN_PASSWORD: "short"
        });

        expect(outcome.status).toBe("skipped");
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    /**
     * Losing the race to a sibling replica is the normal outcome on a scaled
     * deployment, not an error, so a failed create must not take the boot down.
     */
    it("reports rather than throws when the create fails", async () => {
        const { adapter } = mockUsers();
        (adapter.createUser as jest.Mock).mockImplementation(async () => {
            throw new Error("duplicate key value violates unique constraint");
        });

        const outcome = await seedInitialAdmin(adapter, creds);

        expect(outcome.status).toBe("skipped");
    });

    it("says so when there is no user store to seed into", async () => {
        expect((await seedInitialAdmin(undefined, creds)).status).toBe("skipped");
    });
});
