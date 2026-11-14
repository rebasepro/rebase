/**
 * Which columns of the user store are the server's alone, and which properties
 * of a given auth collection hold one without saying so.
 *
 * `users` is the one collection a project is expected to redeclare: it is
 * scaffolded into `config/collections/users.ts` so the panel can present it, and
 * the declaration replaces the default outright rather than merging with it. The
 * flag that goes missing unnoticed in that copy is `excludeFromApi` — the
 * neighbouring `admin.hideFromCollection` and `admin.disabled.hidden` keep the
 * field off the screen and look like they did the job.
 *
 * The rule has two readers and they must agree. The server restores the flag so
 * a read does not serve the scrypt hash and a write cannot set it. The panel
 * needs it just as much: a form opens with a value for every property that is
 * not excluded, and submits that baseline, so a panel that does not know sends
 * `passwordHash: null` with every new user and the server refuses the create.
 */

/**
 * What the rule reads off a collection. A `CollectionConfig` is one; so is a
 * collection a server has loaded and not yet validated.
 */
export interface AuthSecretCandidate {
    auth?: unknown;
    properties?: Record<string, { excludeFromApi?: boolean; columnName?: string } | undefined>;
}

/** Is this collection the one the auth subsystem stores users in? */
function isAuthCollection(collection: AuthSecretCandidate): boolean {
    const auth = collection.auth;
    if (auth === true) return true;
    return typeof auth === "object" && auth !== null && "enabled" in auth && auth.enabled === true;
}

/**
 * The secrets of the built-in user store, in both spellings: the key and the
 * column. A redeclaration is free to rename the key — one project's copy says
 * `password_hash` where the default says `passwordHash` — and the column is the
 * same either way. The auth adapter writes these columns
 * (`builtin-auth-adapter`), and no caller may read or set them — an admin
 * included: nobody has a use for a hash.
 *
 * The class, not a list of the columns someone noticed: every credential or
 * token auth keeps on the user row, and every hash of one. The password hash;
 * the email-verification token; the hash of a pending email-change link. A
 * bookkeeping stamp beside them (`tokens_valid_after`, `email_change_sent_at`,
 * `pending_email`) is not a secret and is served like any column. The other
 * credentials auth keeps — refresh, reset and magic-link tokens, MFA secrets,
 * recovery codes, provider identities — live in its own side tables, which no
 * door serves.
 *
 * A name here is withheld whether or not the table declares the column: the
 * runtime reads every physical column, and auth creates these on any auth
 * table (`ensureAuthTablesExist`), so a table that never mentions
 * `email_change_token` still has one. See `restrictedKeys` / `apiHiddenKeys`.
 */
export const AUTH_SECRET_NAMES: ReadonlySet<string> = new Set([
    "passwordHash", "password_hash",
    "emailVerificationToken", "email_verification_token",
    "emailChangeToken", "email_change_token"
]);

/**
 * The keys of the properties on `collection` that hold an auth secret and do not
 * carry `excludeFromApi`. Empty for any collection that is not the user store: a
 * `password_hash` column elsewhere — a CRM importing hashes, say — is that
 * project's data, not this rule's business.
 */
export function authSecretsMissingExclusion(collection: AuthSecretCandidate): string[] {
    if (!collection.properties || !isAuthCollection(collection)) return [];

    const missing: string[] = [];
    for (const [key, property] of Object.entries(collection.properties)) {
        if (!property || property.excludeFromApi) continue;
        if (AUTH_SECRET_NAMES.has(key) || AUTH_SECRET_NAMES.has(property.columnName ?? key)) missing.push(key);
    }
    return missing;
}
