/**
 * A personal API key finds its owner in one read.
 *
 * Each request made with a personal key looked the owner up twice after the
 * key itself — `getUserById` (a `SELECT *`) for "exists and not disabled", then
 * `getUserRoleIds` for the roles: three serial round trips before the request's
 * own transaction, where an access token costs one. `getAccountAccessState`
 * answers both in one statement, and it is the read every access token is
 * already judged against.
 */
import { keyOwnerResolverFor } from "../src/auth/access";
import type { AccountAccessState, UserData } from "../src/auth/interfaces";

function repoWith(accounts: Record<string, { roles: string[]; disabled?: boolean }>, withAccessState = true) {
    const calls: string[] = [];
    const repo = {
        getUserById: async (uid: string) => {
            calls.push("getUserById");
            const account = accounts[uid];
            return account ? ({ id: uid, ...(account.disabled ? { disabled: true } : {}) } as unknown as UserData) : null;
        },
        getUserRoleIds: async (uid: string) => {
            calls.push("getUserRoleIds");
            return accounts[uid]?.roles ?? [];
        },
        ...(withAccessState ? {
            getAccountAccessState: async (uid: string): Promise<AccountAccessState | null> => {
                calls.push("getAccountAccessState");
                const account = accounts[uid];
                return account
                    ? { roles: account.roles, tokensValidAfter: null, ...(account.disabled ? { disabled: true } : {}) }
                    : null;
            }
        } : {})
    };
    return { repo, calls };
}

const ACCOUNTS = { ada: { roles: ["editor"] }, off: { roles: ["admin"], disabled: true } };

describe("keyOwnerResolverFor", () => {
    it("reads the owner once: roles, existence and disabled together", async () => {
        const { repo, calls } = repoWith(ACCOUNTS);
        const resolve = keyOwnerResolverFor(repo);

        expect(await resolve("ada")).toEqual({ roles: ["editor"] });
        expect(calls).toEqual(["getAccountAccessState"]);
    });

    it.each([true, false])("refuses a disabled owner and a missing one (one-read store: %s)", async (withAccessState) => {
        const { repo } = repoWith(ACCOUNTS, withAccessState);
        const resolve = keyOwnerResolverFor(repo);

        expect(await resolve("off")).toBeNull();
        expect(await resolve("gone")).toBeNull();
        expect(await resolve("ada")).toEqual({ roles: ["editor"] });
    });

    it("falls back to the account and its roles where the store cannot answer at once", async () => {
        const { repo, calls } = repoWith(ACCOUNTS, false);

        expect(await keyOwnerResolverFor(repo)("ada")).toEqual({ roles: ["editor"] });
        expect(calls).toEqual(["getUserById", "getUserRoleIds"]);
    });
});
