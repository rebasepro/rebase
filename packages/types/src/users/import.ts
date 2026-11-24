/**
 * Importing accounts from another system: `POST /admin/users/import`,
 * `client.admin.importUsers()` and `rebase users import`.
 *
 * An import keeps the ids the accounts had, so every row that points at a user
 * still points at the same one, and sends no email. It carries no password,
 * except as the hash the other system stored, and only when the request names
 * the algorithm ({@link IMPORTED_PASSWORD_HASH_ALGORITHMS}): such an account
 * signs in with the password it had, and the hash is replaced by Rebase's own
 * on its first sign-in. Any other imported account signs in by magic link, an
 * email code, a provider, or a password reset.
 */

/**
 * The most accounts one `POST /admin/users/import` takes. The CLI sends a
 * longer file in requests of this size.
 *
 * @group Admin
 */
export const MAX_USERS_PER_IMPORT = 100;

/**
 * The longest id an imported account may keep.
 *
 * @group Admin
 */
export const MAX_IMPORTED_USER_ID_LENGTH = 128;

/**
 * Ids that already mean someone other than an account: the anonymous caller,
 * the service key, and the identity a custom validator's `true` stands for.
 */
const RESERVED_USER_IDS = new Set(["anonymous", "anon", "service", "default"]);

/**
 * Why `id` cannot be kept as an imported account's id, or `undefined` when it
 * can.
 *
 * A uuid is the common case (Supabase, Cognito). Other systems' ids fit too:
 * letters, digits and `_ - . : |`, starting with a letter or a digit, at most
 * {@link MAX_IMPORTED_USER_ID_LENGTH} characters (Firebase's 28-character
 * uids, Auth0's `auth0|5f7c…`, Clerk's `user_2abc…`). Refused: what would read
 * as something else on the way through a URL, a storage path or a CLI argument
 * (`/`, `?`, `%`, whitespace, `@`, which the CLI reads as an email), and the
 * ids that already name a caller who is not an account (`service`,
 * `anonymous`).
 *
 * The users table's id column has the last word: a uuid column refuses an id
 * that is not a uuid.
 *
 * @group Admin
 */
export function importedUserIdProblem(id: unknown): string | undefined {
    if (typeof id !== "string") return "is not a string";
    if (id === "") return "is empty";
    if (id.length > MAX_IMPORTED_USER_ID_LENGTH) return `is longer than ${MAX_IMPORTED_USER_ID_LENGTH} characters`;
    if (!/^[A-Za-z0-9][A-Za-z0-9_.:|-]*$/.test(id)) {
        return "may hold only letters, digits and _ - . : |, starting with a letter or a digit";
    }
    if (RESERVED_USER_IDS.has(id.toLowerCase())) return "is reserved: it names a caller who is not an account";
    return undefined;
}

/**
 * The password hash formats an import takes, as `passwordHashAlgorithm` names
 * them. `bcrypt` is what Supabase (`auth.users.encrypted_password`), Auth0,
 * Clerk and most Rails, Laravel and Django-bcrypt apps store: `$2a$`, `$2b$`
 * or `$2y$`, a two-digit cost, then 53 characters.
 *
 * @group Admin
 */
export const IMPORTED_PASSWORD_HASH_ALGORITHMS = ["bcrypt"] as const;

/**
 * One of {@link IMPORTED_PASSWORD_HASH_ALGORITHMS}.
 *
 * @group Admin
 */
export type ImportedPasswordHashAlgorithm = typeof IMPORTED_PASSWORD_HASH_ALGORITHMS[number];

/**
 * Why `hash` is not a password hash of `algorithm` an import takes, or
 * `undefined` when it is. Checked before anything is written, so a column of
 * the wrong thing (a plain password, a scrypt string) fails the row instead
 * of creating an account nobody can sign into.
 *
 * @group Admin
 */
export function importedPasswordHashProblem(hash: unknown, algorithm: ImportedPasswordHashAlgorithm): string | undefined {
    if (typeof hash !== "string") return "is not a string";
    if (algorithm === "bcrypt") {
        const match = /^\$2[aby]\$(\d{2})\$[./A-Za-z0-9]{53}$/.exec(hash);
        if (!match) return "is not a bcrypt hash: one starts with $2a$, $2b$ or $2y$, then a two-digit cost and 53 characters";
        const cost = Number(match[1]);
        if (cost < 4 || cost > 31) return `has a bcrypt cost of ${cost}, outside 4 to 31`;
    }
    return undefined;
}

/**
 * One account to import.
 *
 * @group Admin
 */
export interface ImportUserInput {
    /**
     * The id the account had in the system it comes from, kept as its id here.
     * Omitted, the users table generates one. See {@link importedUserIdProblem}.
     */
    id?: string;
    email: string;
    displayName?: string;
    photoUrl?: string;
    /** When the account was created in the system it comes from, as an ISO 8601 date. Omitted: now. */
    createdAt?: string;
    /**
     * Whether that system had confirmed the address. Omitted: `false`, and the
     * first magic link or reset the account follows confirms it. An unconfirmed
     * account cannot be signed into by a provider (Google, GitHub) until then.
     */
    emailVerified?: boolean;
    /** Role names, as `POST /admin/users` takes them. No caller may grant a role above its own. */
    roles?: string[];
    /**
     * The password hash the other system stored, taken only when the request
     * names its algorithm in `passwordHashAlgorithm`. The account then signs
     * in with the password it had. Omitted: no password, as before.
     */
    passwordHash?: string;
}

/**
 * The body of `POST /admin/users/import`.
 *
 * @group Admin
 */
export interface ImportUsersRequest {
    /** At most {@link MAX_USERS_PER_IMPORT}. */
    users: ImportUserInput[];
    /** Check every account and report what would happen, writing nothing. */
    dryRun?: boolean;
    /**
     * The format of every `passwordHash` in `users`. Required when any account
     * carries one: a hash whose format nobody declared is refused, never
     * guessed at.
     */
    passwordHashAlgorithm?: ImportedPasswordHashAlgorithm;
}

/**
 * What happened to one account of an import. `index` is its place in the
 * request's `users`.
 *
 * - `created`: the account exists now (with `dryRun`, it would be created).
 * - `skipped`: an account already holds the id (`ID_EXISTS`) or the email
 *   (`EMAIL_EXISTS`), an earlier one in this request included. It is left as
 *   it is: an import never updates an account.
 * - `failed`: the account was refused, and `code` and `message` say why.
 *
 * @group Admin
 */
export type ImportUserOutcome =
    | { index: number; status: "created"; uid?: string; email: string }
    | { index: number; status: "skipped"; uid?: string; email: string; code: "ID_EXISTS" | "EMAIL_EXISTS"; message: string }
    | { index: number; status: "failed"; uid?: string; email?: string; code: string; message: string };

/**
 * The answer of `POST /admin/users/import`: one outcome per account, in the
 * order they were sent, and how many of each.
 *
 * @group Admin
 */
export interface ImportUsersResult {
    /** Nothing was written: `created` counts the accounts that would be. */
    dryRun: boolean;
    created: number;
    skipped: number;
    failed: number;
    results: ImportUserOutcome[];
}
