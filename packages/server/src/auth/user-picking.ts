/**
 * Who may read the user picker (`GET /api/admin/users/pick`).
 *
 * A `userSelect` field stores a user's id, and the person filling it in picks
 * that user from a list. Listing the users is an admin-plane read
 * (`users:read`), which an editor does not hold — so the picker answers a
 * narrower question for a wider audience: id, name, email and avatar, to
 * anyone who may write a collection that has such a field.
 *
 * "May write" is the collection's `securityRules` for an insert or an update,
 * evaluated the way the admin panel decides whether to offer the form: a rule
 * that depends on the row (an owner field) or on raw SQL counts as allowing,
 * since the person may write some row. A key or token narrowed by scopes must
 * also hold `data:write` on that collection.
 *
 * The collections are read through a getter configured at boot, so a schema
 * edited live is what is judged.
 *
 * @module
 */
import type { Context } from "hono";
import { checkOperation } from "@rebasepro/common";
import { isAnonymousUid, type CollectionConfig, type Properties, type Property, type User } from "@rebasepro/types";
import type { HonoEnv } from "../api/types";
import { hasScope } from "./access";

let collectionsForPicking: () => readonly CollectionConfig[] = () => [];

/** Tell the picker which collections this backend serves. Called once at boot. */
export function configureUserPicking(collections: () => readonly CollectionConfig[]): void {
    collectionsForPicking = collections;
}

function propertyReferencesUsers(property: Property | undefined): boolean {
    if (!property) return false;
    if (property.type === "string" && property.userSelect === true) return true;
    if (property.type === "map") return propertiesReferenceUsers(property.properties);
    if (property.type === "array") {
        const of = property.of;
        if (Array.isArray(of)) return of.some(propertyReferencesUsers);
        if (of) return propertyReferencesUsers(of);
        return propertiesReferenceUsers(property.oneOf?.properties);
    }
    return false;
}

/** Whether any property, at any depth, is a `userSelect` field. */
export function propertiesReferenceUsers(properties: Properties | undefined): boolean {
    return !!properties && Object.values(properties).some(propertyReferencesUsers);
}

/** The signed-in person behind a request, as the policy evaluator reads one. */
function personOf(c: Context<HonoEnv>): User | null {
    const user = c.get("user");
    if (typeof user !== "object" || user === null) return null;
    const uid = typeof user.uid === "string" ? user.uid : undefined;
    if (!uid || isAnonymousUid(uid)) return null;
    if ("isAnonymous" in user && user.isAnonymous === true) return null;
    const roles = Array.isArray(user.roles) ? user.roles.filter((role): role is string => typeof role === "string") : [];
    return { uid, roles, isAnonymous: false, displayName: null, email: null, photoURL: null, providerId: "custom" };
}

/**
 * Whether this request's caller may read the user picker: they hold
 * `users:read`, or they may write a collection with a `userSelect` field.
 */
export function mayPickUsers(c: Context<HonoEnv>): boolean {
    if (hasScope(c, "users:read")) return true;
    const person = personOf(c);
    if (!person) return false;
    return collectionsForPicking().some(collection =>
        propertiesReferenceUsers(collection.properties)
        && hasScope(c, "data:write", collection.slug)
        && (checkOperation(collection, { user: person }, null, "insert")
            || checkOperation(collection, { user: person }, null, "update")));
}
