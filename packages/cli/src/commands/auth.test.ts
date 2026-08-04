/**
 * Which account `rebase auth reset-password` actually resets.
 *
 * The command looks the user up through `/api/admin/users?search=`, which is an
 * `ILIKE '%…%'` over **email OR display name**, ordered by role count
 * descending. It then took the first row and reset that user's password,
 * without ever checking the row's email against the one it was asked for — and
 * printed the email it had been *given* as confirmation.
 *
 * So the two ways it can go wrong both end in "success":
 *   - a substring collision (`bob@example.com` also matches
 *     `robert.bob@example.com`);
 *   - a display name, which is user-controlled and unconstrained, containing
 *     somebody else's address.
 *
 * The ordering makes it worse rather than better: `array_length(roles) DESC
 * NULLS LAST` puts the *most privileged* match first.
 *
 * The command's own direct-database fallback matches with
 * `eq(usersTable.email, email)` — exactly. So one command had two definitions
 * of "the user with this email" and picked between them on whether the backend
 * happened to be running.
 */
import { describe, it, expect } from "vitest";
import { selectUserForEmail } from "./auth";

describe("selectUserForEmail", () => {
    it("finds the user whose email matches exactly", () => {
        const users = [{ id: "u1", email: "bob@example.com" }];

        expect(selectUserForEmail(users, "bob@example.com")?.id).toBe("u1");
    });

    it("accepts either `id` or `uid` as the identifier", () => {
        expect(selectUserForEmail([{ uid: "u9", email: "bob@example.com" }], "bob@example.com")?.id).toBe("u9");
    });

    it("reads the wrapped `{ users: [...] }` shape as well as a bare array", () => {
        const payload = { users: [{ id: "u1", email: "bob@example.com" }] };

        expect(selectUserForEmail(payload, "bob@example.com")?.id).toBe("u1");
    });

    it("ignores a substring match in favour of the exact one", () => {
        // The search returns both, most-privileged first. Taking `[0]` reset
        // the admin's password and reported success for bob.
        const users = [
            { id: "admin", email: "robert.bob@example.com" },
            { id: "bob", email: "bob@example.com" }
        ];

        expect(selectUserForEmail(users, "bob@example.com")?.id).toBe("bob");
    });

    it("refuses to pick anyone when only a substring matched", () => {
        const users = [{ id: "admin", email: "robert.bob@example.com" }];

        expect(selectUserForEmail(users, "bob@example.com")).toBeUndefined();
    });

    it("refuses a row matched only by its display name", () => {
        // Display names are user-controlled and accepted up to 255 characters
        // with no constraint on their content.
        const users = [{ id: "impostor", email: "mallory@evil.test", displayName: "admin@company.com" }];

        expect(selectUserForEmail(users, "admin@company.com")).toBeUndefined();
    });

    it("matches case- and whitespace-insensitively, as addresses are", () => {
        const users = [{ id: "u1", email: "Bob@Example.COM" }];

        expect(selectUserForEmail(users, "  bob@example.com ")?.id).toBe("u1");
    });

    it("returns nothing for an empty or unusable response", () => {
        expect(selectUserForEmail([], "bob@example.com")).toBeUndefined();
        expect(selectUserForEmail(null, "bob@example.com")).toBeUndefined();
        expect(selectUserForEmail({ users: [] }, "bob@example.com")).toBeUndefined();
        expect(selectUserForEmail([{ id: "u1" }], "bob@example.com")).toBeUndefined();
    });
});
