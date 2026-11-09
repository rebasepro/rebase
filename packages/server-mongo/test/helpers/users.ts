import type { User } from "@rebasepro/types";

/** A signed-in password user with the given uid and roles. */
export function signedInUser(uid: string, roles: string[] = []): User {
    return {
        uid,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "password",
        isAnonymous: false,
        roles
    };
}
