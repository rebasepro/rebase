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
import { describe, it, expect, vi } from "vitest";
import { authCommand, RESET_PASSWORD_FLAGS, resolveResetPasswordArgs, selectUserForEmail, generatePassword } from "./auth";

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

/**
 * Which password `rebase auth reset-password` is about to set.
 *
 * The parser ran `arg` permissively and read `_[1]`, so an undeclared flag was
 * pushed into the positionals as a bare token and became the new password. Both
 * ways in were things the product tells you to type: `--debug` is what
 * `bin/rebase.js` prints after every failure ("Re-run with --debug for the stack
 * trace"), and `-p` was advertised in this command's own help while never being
 * declared — so following the help set the account's password to `-p`.
 */
describe("resolveResetPasswordArgs", () => {
    /** A full `process.argv`, the way `cli.ts` hands it to a command. */
    const line = (...rest: string[]): string[] =>
        ["/usr/bin/node", "/usr/local/bin/rebase", "auth", "reset-password", ...rest];

    it("reads the email and the password as positionals", () => {
        expect(resolveResetPasswordArgs(line("bob@example.com", "S3cret!"))).toEqual({
            email: "bob@example.com",
            password: "S3cret!"
        });
    });

    it("does not turn --debug into the new password", () => {
        expect(resolveResetPasswordArgs(line("bob@example.com", "--debug"))).toEqual({
            email: "bob@example.com",
            password: undefined
        });
    });

    it("honours -p, which the help has always advertised", () => {
        expect(resolveResetPasswordArgs(line("bob@example.com", "-p", "S3cret!"))).toEqual({
            email: "bob@example.com",
            password: "S3cret!"
        });
        expect(resolveResetPasswordArgs(line("--email", "bob@example.com", "-p", "S3cret!"))).toEqual({
            email: "bob@example.com",
            password: "S3cret!"
        });
    });

    it("refuses a flag nobody declared rather than resetting the account to it", () => {
        expect(() => resolveResetPasswordArgs(line("bob@example.com", "--force")))
            .toThrow(/unknown or unexpected option/);
    });

    it("is not shifted by a flag placed before the command", () => {
        expect(resolveResetPasswordArgs([
            "/usr/bin/node",
            "/usr/local/bin/rebase",
            "--debug",
            "auth",
            "reset-password",
            "bob@example.com",
            "S3cret!"
        ])).toEqual({
            email: "bob@example.com",
            password: "S3cret!"
        });
    });

    it("declares every short alias its own help advertises", async () => {
        // Class 21 in reverse: `-p` was documented and unimplemented, so the
        // help *was* the instruction that caused the bug. Keep the two in step.
        const printed: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation(message => {
            printed.push(String(message));
        });
        try {
            await authCommand(undefined, []);
        } finally {
            spy.mockRestore();
        }

        // eslint-disable-next-line no-control-regex
        const help = printed.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
        const advertised = [...help.matchAll(/--[a-z-]+, (-[a-z])/g)].map(match => match[1]);

        expect(advertised.length).toBeGreaterThan(0);
        for (const alias of advertised) {
            expect(Object.keys(RESET_PASSWORD_FLAGS)).toContain(alias);
        }
    });
});

/**
 * What a reset sets when nobody said what to set it to.
 *
 * The answer used to be the string `NewPassword123!`, and `--help` advertised
 * it. Reset is the documented way back into an account nobody can sign in to,
 * which in practice means an admin — so the recovery path put every recovered
 * account on one constant, published in a public repository and inside the npm
 * package, until a human remembered to change it. On a deployment where the
 * first registration becomes admin, that is the whole chain.
 */
describe("the generated reset password", () => {
    it("is not a constant", () => {
        const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
        expect(seen.size).toBe(50);
    });

    it("carries enough entropy to be worth generating", () => {
        const pw = generatePassword();
        // 18 random bytes in base64url — 24 characters, ~144 bits.
        expect(pw).toMatch(/^[A-Za-z0-9_-]{24}$/);
    });

    it("needs no shell quoting, so it survives being pasted", () => {
        for (let i = 0; i < 200; i++) {
            // base64url excludes the whole set that changes meaning in a shell,
            // in a .env line, or in a URL: quotes, spaces, $ ` \ ; & | < > and +/=.
            expect(generatePassword()).not.toMatch(/[^A-Za-z0-9_-]/);
        }
    });
});
