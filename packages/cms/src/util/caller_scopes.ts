import { scopeGrants } from "@rebasepro/types";

/**
 * Does the signed-in caller hold `scope`? Read off the controller's
 * `heldScopes` — `GET /auth/scopes` — so an action is offered, or an admin
 * route asked, by exactly those the route admits. Not known yet is no.
 */
export function callerHoldsScope(authController: unknown, scope: string): boolean {
    if (!reportsScopes(authController)) return false;
    const held = authController.heldScopes;
    return Array.isArray(held) && scopeGrants(held.filter((entry): entry is string => typeof entry === "string"), scope);
}

/**
 * Does the controller report the caller's scopes at all? `useRebaseAuthController`
 * does (`undefined` until they are known). A controller without the field,
 * such as `useAuthSubscription` or a hand-written one, cannot say, and a gate
 * built on it has to fall back to asking the backend.
 */
export function reportsScopes(authController: unknown): authController is { heldScopes?: unknown } {
    return typeof authController === "object" && authController !== null && "heldScopes" in authController;
}
