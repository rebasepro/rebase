/**
 * Every path that writes `users.email` must agree with every path that reads it.
 *
 * The database is what makes this a correctness question rather than a tidiness
 * one: `ensureAuthTablesExist` puts a `UNIQUE INDEX ON users (lower(email))` on
 * the table, and that index does not trim. `' foo@bar.com'` and `'foo@bar.com'`
 * are two distinct keys to Postgres, so a write that stores the first survives
 * the index alongside the second — while `getUserByEmail`, which trims, can
 * only ever find the second. The account exists and cannot be signed into.
 *
 * The admin create paths reached the column without passing a Zod schema:
 * `POST /api/data/users` goes through `prepareUserCreation` →
 * `prepareAdminUserValues`, and `POST /api/auth/admin/users` reads `body.email`
 * raw. Both lower-cased without trimming. The HTTP auth routes were unaffected
 * only because Zod's `.email()` happens to reject surrounding whitespace, which
 * is a guard on a different layer for a different reason.
 *
 * These tests pin the *agreement* rather than restating the answer: the
 * assertion is that the write path and the read path produce the same key, so a
 * future change to one that is not made to the other fails here.
 */

import { normalizeEmail } from "@rebasepro/common";
import { prepareAdminUserValues, type AdminUserContext } from "../src/auth/admin-user-ops";
import { resolveAuthHooks } from "../src/auth/auth-hooks";

/** What the `lower(email)` unique index actually keys on. It does not trim. */
const indexKey = (stored: string) => stored.toLowerCase();

/**
 * The built-in path — no collection hook, no backend hook — which is the one
 * that reaches `values.email` itself. A hook that handles the email sets
 * `hookHandledEmail` and owns the normalization instead.
 */
const ctx = (): AdminUserContext => ({
    authRepo: {} as never,
    resolvedHooks: resolveAuthHooks(undefined)
});

const MESSY = "  Foo@Bar.COM  ";
const CLEAN = "foo@bar.com";

describe("email normalization agreement", () => {

    it("normalizeEmail trims as well as folds case", () => {
        expect(normalizeEmail(MESSY)).toBe(CLEAN);
    });

    it("passes non-strings through, so a partial update payload is safe", () => {
        expect(normalizeEmail(undefined)).toBeUndefined();
        expect(normalizeEmail(null)).toBeNull();
        expect(normalizeEmail(42)).toBe(42);
    });

    it("the admin create path stores what the lookup path searches for", async () => {
        const prepared = await prepareAdminUserValues(
            { email: MESSY, password: "correct-horse-battery-staple" },
            ctx()
        );

        const stored = prepared.values.email as string;

        // The bug: stored was "  foo@bar.com  " while the lookup searched for
        // "foo@bar.com", so the row was unreachable the moment it was written.
        expect(stored).toBe(normalizeEmail(MESSY));
    });

    it("a stray space cannot create a second account for one address", async () => {
        const withSpace = await prepareAdminUserValues(
            { email: MESSY, password: "correct-horse-battery-staple" },
            ctx()
        );
        const without = await prepareAdminUserValues(
            { email: CLEAN, password: "correct-horse-battery-staple" },
            ctx()
        );

        // Both must land on the same UNIQUE key, or Postgres accepts both rows.
        expect(indexKey(withSpace.values.email as string))
            .toBe(indexKey(without.values.email as string));
    });
});
