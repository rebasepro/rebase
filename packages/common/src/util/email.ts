/**
 * Email normalization — one implementation, because the database enforces it.
 *
 * `ensureAuthTablesExist` puts a `UNIQUE INDEX ON users (lower(email))` on the
 * auth table. That index decides what "the same address" means, and it does not
 * trim: to Postgres, `' foo@bar.com'` and `'foo@bar.com'` are two addresses and
 * both may exist. So every write that reaches the column has to agree with
 * every read, exactly, or the two disagree in the one direction that matters —
 * a row that exists and cannot be found.
 *
 * That is not hypothetical. The lookup path trimmed and the admin create paths
 * did not, so a user created through `POST /api/data/users` or
 * `POST /api/auth/admin/users` with a stray space was stored untrimmed,
 * survived the unique index alongside the real address, and was unreachable by
 * login forever after. The HTTP auth routes were unaffected only because Zod's
 * `.email()` happens to reject surrounding whitespace — a guard on a different
 * layer, for a different reason, that the admin paths do not sit behind.
 *
 * It lives in `common` because `server`, `server-postgres` and `server-mongo`
 * all write this column and must agree exactly, and `common` is the only
 * package all three already depend on.
 */

/**
 * Canonical form of an email address: trimmed, lower-cased.
 *
 * Non-strings pass through untouched, so this is safe to apply to a value out
 * of a partial update payload whose type is not known yet.
 */
export function normalizeEmail<T>(email: T): T | string {
    return typeof email === "string" ? email.trim().toLowerCase() : email;
}
