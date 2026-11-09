/**
 * The caller's account, read for a custom function (`getUserProfile(c)`).
 *
 * An access token carries the caller's id, roles and address, and nothing
 * else: no display name, no photo, and not which providers the account can
 * sign in with. Minting those into the token would not have been enough
 * either — a token is what the account was when it was minted, so a provider
 * linked a minute ago would be missing from it until the next refresh, an
 * hour away. Applications that needed them read the auth tables with raw SQL.
 *
 * So the answer is read from the auth store when a function asks for it: two
 * keyed lookups (the account, its linked identities) issued together, on the
 * first call only and shared by the rest of the request. A request that never
 * asks pays nothing.
 */
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import type { UserProfile } from "../functions/context";
import type { AuthRepository, UserData, UserIdentityData } from "./interfaces";

/** The uids an auth middleware gives a caller that acts as no account. */
const NOT_AN_ACCOUNT = new Set(["service", "default"]);

/** The parts of the auth store a profile is read from. */
export type UserProfileSource = Pick<AuthRepository, "getUserById" | "getUserIdentities">;

/** A {@link UserProfile} from an account and its linked identities. */
export function profileFromAccount(user: UserData, identities: readonly UserIdentityData[]): UserProfile {
    const linked = [...identities]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map(identity => identity.provider);
    const providers = [...new Set([...(user.passwordHash ? ["password"] : []), ...linked])];
    return {
        uid: user.id,
        ...(user.email ? { email: user.email } : {}),
        ...(user.displayName ? { displayName: user.displayName } : {}),
        ...(user.photoUrl ? { photoURL: user.photoUrl } : {}),
        emailVerified: user.emailVerified,
        isAnonymous: user.isAnonymous ?? false,
        providers
    };
}

/**
 * Leaves a loader for the caller's {@link UserProfile} on the context, read on
 * its first call and remembered for the rest of the request. Mounted after the
 * auth middleware, which decides who the caller is.
 */
export function createUserProfileLoader(source: UserProfileSource): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        let pending: Promise<UserProfile | undefined> | undefined;
        c.set("userProfile", () => {
            pending ??= (async () => {
                const raw = c.get("user");
                const uid = raw && typeof raw === "object" && typeof raw.uid === "string" ? raw.uid : undefined;
                if (!uid || NOT_AN_ACCOUNT.has(uid)) return undefined;
                const [user, identities] = await Promise.all([source.getUserById(uid), source.getUserIdentities(uid)]);
                return user ? profileFromAccount(user, identities) : undefined;
            })();
            return pending;
        });
        return next();
    };
}
