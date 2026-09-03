import { defaultUsersCollection } from "@rebasepro/common";
import { logger } from "../utils/logger";

/**
 * Keep the auth collection's secret columns off the API, whoever declared it.
 *
 * `users` is the one collection a project is *expected* to redeclare: it is
 * scaffolded into `config/collections/users.ts` so the panel can present it, and
 * a slug collision replaces the framework's default outright rather than merging
 * with it. So every protection the default carried has to be restated by hand in
 * the copy — and the one that is invisible when it goes missing is
 * `excludeFromApi`.
 *
 * It is invisible because the neighbouring options *look* like they do the same
 * job. `admin.hideFromCollection` and `admin.disabled.hidden` keep a field out of
 * the CMS, which is what a person editing that file is thinking about, and a
 * declaration carrying both of those reads as careful. Neither one strips the
 * column from a row on the wire; only `excludeFromApi` does. The result is a
 * users collection that hides the password hash from the admin panel and serves
 * it to anyone whose read policy admits the row.
 *
 * Which is not hypothetical: it is what the platform's own control plane did,
 * where the read policy deliberately admits co-members so the Members view can
 * name them, and every colleague's browser was therefore handed everyone's
 * scrypt hash and any pending email-verification token.
 *
 * So the framework restates it. Not by rejecting the collection — a boot failure
 * over a field a developer never thought about is a bad trade, and an existing
 * deployment would stop rather than start protecting itself — but by adding the
 * flag and saying so. Which columns count is not a second list to maintain: it
 * is read off {@link defaultUsersCollection}, so a secret added there is covered
 * here on the same commit.
 */

/**
 * The column names the default users collection marks `excludeFromApi`.
 *
 * Keyed by *column*, not by property name, because the whole point is to match a
 * redeclaration that chose different property names — the control plane's copy
 * spelled them `password_hash` and `email_verification_token` where the default
 * says `passwordHash` and `emailVerificationToken`.
 */
function defaultExcludedColumns(): Set<string> {
    const properties = (defaultUsersCollection.properties ?? {}) as Record<
        string,
        { excludeFromApi?: boolean; columnName?: string } | undefined
    >;
    const columns = new Set<string>();
    for (const [key, property] of Object.entries(properties)) {
        if (!property?.excludeFromApi) continue;
        columns.add(property.columnName ?? key);
        columns.add(key);
    }
    return columns;
}

type MutableProperty = { excludeFromApi?: boolean; columnName?: string };
type MutableCollection = {
    slug?: string;
    auth?: unknown;
    properties?: Record<string, MutableProperty | undefined>;
};

/** Is this collection the one the auth subsystem stores users in? */
function isAuthCollection(collection: MutableCollection): boolean {
    const auth = collection.auth;
    if (auth === true) return true;
    return Boolean(auth && typeof auth === "object" && (auth as { enabled?: boolean }).enabled === true);
}

/**
 * Force `excludeFromApi` onto the auth collection's secret columns.
 *
 * Mutates in place and must therefore run BEFORE the collections are registered:
 * each registry re-normalizes what it is given, and a flag set afterwards
 * reaches whichever copy happened to be mutated and no others.
 *
 * @returns the columns it had to fix, per collection — for the caller to log and
 *          for tests to assert on.
 */
export function enforceAuthSecretExclusion(
    collections: readonly unknown[]
): Array<{ slug: string; columns: string[] }> {
    const secrets = defaultExcludedColumns();
    const fixed: Array<{ slug: string; columns: string[] }> = [];

    for (const raw of collections) {
        const collection = raw as MutableCollection;
        if (!collection?.properties || !isAuthCollection(collection)) continue;

        const columns: string[] = [];
        for (const [key, property] of Object.entries(collection.properties)) {
            if (!property || property.excludeFromApi) continue;
            const column = property.columnName ?? key;
            if (!secrets.has(column) && !secrets.has(key)) continue;
            property.excludeFromApi = true;
            columns.push(key);
        }

        if (columns.length > 0) {
            fixed.push({ slug: collection.slug ?? "(unnamed)", columns });
        }
    }

    for (const { slug, columns } of fixed) {
        logger.warn(
            `[Auth] The auth collection "${slug}" declares ${columns.map(c => `'${c}'`).join(", ")} ` +
            "without excludeFromApi, so the column would have been served in every row a read " +
            "policy admits — hiding a field in the admin panel does not strip it from the API. " +
            "Rebase has excluded it. Add `excludeFromApi: true` to the property to make that " +
            "explicit, and regenerate the SDK."
        );
    }

    return fixed;
}
