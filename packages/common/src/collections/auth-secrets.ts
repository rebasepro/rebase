import type { Properties } from "@rebasepro/types";
import { defaultUsersCollection } from "./default-collections";

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
 * The column names, and property keys, the default users collection marks
 * `excludeFromApi`.
 *
 * Both spellings, because a redeclaration is free to rename the property: one
 * project's copy says `password_hash` where the default says `passwordHash`, and
 * the column is the same either way. Read off {@link defaultUsersCollection}, so
 * a secret added there is covered on the same commit.
 */
function defaultSecretNames(): Set<string> {
    const properties: Properties = defaultUsersCollection.properties;
    const names = new Set<string>();
    for (const [key, property] of Object.entries(properties)) {
        if (!property?.excludeFromApi) continue;
        names.add(key);
        if (property.columnName) names.add(property.columnName);
    }
    return names;
}

/**
 * The keys of the properties on `collection` that hold an auth secret and do not
 * carry `excludeFromApi`. Empty for any collection that is not the user store: a
 * `password_hash` column elsewhere — a CRM importing hashes, say — is that
 * project's data, not this rule's business.
 */
export function authSecretsMissingExclusion(collection: AuthSecretCandidate): string[] {
    if (!collection.properties || !isAuthCollection(collection)) return [];

    const secrets = defaultSecretNames();
    const missing: string[] = [];
    for (const [key, property] of Object.entries(collection.properties)) {
        if (!property || property.excludeFromApi) continue;
        if (secrets.has(key) || secrets.has(property.columnName ?? key)) missing.push(key);
    }
    return missing;
}
