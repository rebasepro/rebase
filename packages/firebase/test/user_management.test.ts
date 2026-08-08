import { describe, expect, it } from "@jest/globals";
import { resolveAccessDecision } from "../src/hooks/useBuildUserManagement";

const user = { email: "someone@example.com" };

describe("resolveAccessDecision", () => {

    it("admits everyone while the users collection is empty", () => {
        // The bootstrap: the first admin has to be able to get in.
        expect(resolveAccessDecision({
            loading: false,
            users: [],
            user
        })).toBe("bootstrap");
    });

    it("does not bootstrap when the users collection could not be read", () => {
        // The listener's onError empties the user list, so this arrives at the
        // gate looking exactly like the empty collection above. It is not one:
        // a permission-denied on the users path used to admit every
        // authenticated user.
        expect(resolveAccessDecision({
            loading: false,
            usersError: new Error("Missing or insufficient permissions."),
            users: [],
            user
        })).toBe("users-unreadable");
    });

    it("denies a listed user too when the collection could not be read", () => {
        // A stale list read before the error is not evidence either.
        expect(resolveAccessDecision({
            loading: false,
            usersError: new Error("Missing or insufficient permissions."),
            users: [user],
            user
        })).toBe("users-unreadable");
    });

    it("waits while loading", () => {
        expect(resolveAccessDecision({
            loading: true,
            users: [],
            user
        })).toBe("loading");
    });

    it("denies a logged-out user", () => {
        expect(resolveAccessDecision({
            loading: false,
            users: [],
            user: null
        })).toBe("no-user");
    });

    it("recognises a listed user, whatever the casing", () => {
        expect(resolveAccessDecision({
            loading: false,
            users: [{ email: "SOMEONE@EXAMPLE.COM" }],
            user
        })).toBe("known-user");
    });

    it("rejects a user who is not in the collection", () => {
        expect(resolveAccessDecision({
            loading: false,
            users: [{ email: "other@example.com" }],
            user
        })).toBe("unknown-user");
    });

});
