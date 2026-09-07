import { describe, it, expect, jest } from "@jest/globals";
import { seedInitialAdmin } from "../src/auth/seed-admin";
import { isBootstrapWindowOpen, isRegistrationOpen } from "../src/auth/registration-policy";
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

    /**
     * `NODE_ENV: "production"` is part of the credential, not decoration: the
     * seed is the production half of the contract, and outside production the
     * first registration is still the way in. See the last two cases.
     */
    const creds = {
        REBASE_ADMIN_EMAIL: "ops@acme.test",
        REBASE_ADMIN_PASSWORD: "a-long-enough-secret",
        NODE_ENV: "production"
    };

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

        const outcome = await seedInitialAdmin(adapter, {
            REBASE_ADMIN_EMAIL: "ops@acme.test",
            NODE_ENV: "production"
        });

        expect(outcome.status).toBe("skipped");
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    it("refuses a short password for an account that is admin on a live host", async () => {
        const { adapter } = mockUsers();

        const outcome = await seedInitialAdmin(adapter, {
            REBASE_ADMIN_EMAIL: "ops@acme.test",
            REBASE_ADMIN_PASSWORD: "short",
            NODE_ENV: "production"
        });

        expect(outcome.status).toBe("skipped");
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    /**
     * An address the login route will not parse is an account nobody can use.
     *
     * `admin@localhost` was quickstart.sh's default. It seeds without complaint
     * — nothing here looked at the address — and `POST /auth/login` parses its
     * body with `z.string().email()`, which rejects a domain with no dot. So the
     * documented self-host path produced a server with an admin row, a
     * `needsSetup` of false (the account exists, so the first-run path is gone
     * too), and a 400 on every attempt to sign in. Refused at boot instead,
     * while somebody is still reading the log.
     */
    it("refuses an address the login route would reject", async () => {
        const { adapter } = mockUsers();

        const outcome = await seedInitialAdmin(adapter, {
            REBASE_ADMIN_EMAIL: "admin@localhost",
            REBASE_ADMIN_PASSWORD: "a-perfectly-long-password",
            NODE_ENV: "production"
        });

        expect(outcome.status).toBe("skipped");
        expect(adapter.createUser).not.toHaveBeenCalled();
    });

    it("still accepts an ordinary address", async () => {
        const { adapter } = mockUsers();

        const outcome = await seedInitialAdmin(adapter, {
            REBASE_ADMIN_EMAIL: "ops@acme.test",
            REBASE_ADMIN_PASSWORD: "a-perfectly-long-password",
            NODE_ENV: "production"
        });

        expect(outcome.status).toBe("created");
        expect(adapter.createUser).toHaveBeenCalled();
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

    /**
     * The regression this half of the contract exists for.
     *
     * `rebase init` writes `REBASE_ADMIN_EMAIL` and a generated password into
     * `.env` — for the compose stack, which runs `NODE_ENV=production`. But
     * `rebase dev` reads the same `.env`, so an unconditional seed created that
     * account at the first boot, the user table stopped being empty, and the
     * quickstart's own first step — register, become the admin — produced a
     * role-less account. Nothing in the first-run path named the credentials
     * that had taken its place.
     */
    it("does not seed where the first registration is still the way in", async () => {
        const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);
        try {
            const { adapter } = mockUsers();

            const outcome = await seedInitialAdmin(adapter, {
                ...creds,
                NODE_ENV: "development"
            });

            expect(outcome).toEqual({ status: "window-open" });
            expect(adapter.createUser).not.toHaveBeenCalled();
            // Announced, not silent: the variables are in the `.env` the
            // scaffold generated, and an operator who set them is owed the
            // reason the account they named is not there.
            expect(info).toHaveBeenCalledWith(expect.stringContaining("REBASE_ADMIN_EMAIL"));
        } finally {
            info.mockRestore();
        }
    });

    /**
     * The two halves are one mechanism, so they are asserted together: exactly
     * one way in exists at a time. Separately, each half has passed while the
     * pair produced a deployment with two ways in (development) or none
     * (production, nothing named).
     */
    it("is the only way in where the window is shut, and no way in where it is open", async () => {
        const production = { NODE_ENV: "production" };
        const development = { NODE_ENV: "development" };

        expect(isBootstrapWindowOpen(production)).toBe(false);
        expect(isRegistrationOpen({
            needsSetup: true,
            bootstrapWindowOpen: isBootstrapWindowOpen(production)
        })).toBe(false);
        expect((await seedInitialAdmin(mockUsers().adapter, { ...creds, ...production })).status)
            .toBe("created");

        expect(isBootstrapWindowOpen(development)).toBe(true);
        expect(isRegistrationOpen({
            needsSetup: true,
            bootstrapWindowOpen: isBootstrapWindowOpen(development)
        })).toBe(true);
        const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);
        try {
            expect((await seedInitialAdmin(mockUsers().adapter, { ...creds, ...development })).status)
                .toBe("window-open");
        } finally {
            info.mockRestore();
        }
    });

    it("treats an absent NODE_ENV as development, like every other window check", async () => {
        const info = jest.spyOn(logger, "info").mockImplementation(() => undefined);
        try {
            const { adapter } = mockUsers();

            const outcome = await seedInitialAdmin(adapter, {
                REBASE_ADMIN_EMAIL: "ops@acme.test",
                REBASE_ADMIN_PASSWORD: "a-long-enough-secret"
            });

            expect(outcome).toEqual({ status: "window-open" });
            expect(adapter.createUser).not.toHaveBeenCalled();
        } finally {
            info.mockRestore();
        }
    });
});
