import type { User } from "@rebasepro/types";

/**
 * A complete `User` for a test caller.
 *
 * The driver reads `uid`, `roles`, `isAnonymous` and `claims` off a user; the
 * rest of the type is profile data a test has no opinion on, filled with the
 * values a fresh, signed-in, non-anonymous account carries.
 */
export function testUser(uid: string, roles: string[] = [], overrides: Partial<User> = {}): User & { roles: string[] } {
    return {
        uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "test",
        isAnonymous: false,
        ...overrides,
        roles: overrides.roles ?? roles
    };
}
