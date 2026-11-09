/**
 * A signed-in `User`, for tests that only care about the uid and roles.
 *
 * `User` declares the profile fields a provider fills in as required — null
 * when there is nothing — so a fixture of `{ uid, roles }` had to be cast.
 */
import type { User } from "@rebasepro/types";

export function testUser(uid: string, roles: string[] = [], extra: Partial<User> = {}): User {
    return {
        uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "test",
        isAnonymous: false,
        roles,
        ...extra
    };
}
