import type { CollectionReview, StagedChangeOperation } from "./types";

/** Whether a role list holds any of `wanted`. */
function holdsAny(roles: readonly string[], wanted: readonly string[] | undefined): boolean {
    return !!wanted && wanted.some(role => roles.includes(role));
}

/**
 * Whether a caller holding `roles` reviews a collection: the `admin` role
 * always does, and so does any role its review lists in `reviewerRoles`.
 *
 * @group Review
 */
export function isReviewer(roles: readonly string[], review: CollectionReview): boolean {
    return roles.includes("admin") || holdsAny(roles, review.reviewerRoles);
}

/**
 * Whether a caller holding `roles` may propose `operation` on a staged-table
 * collection: the operation is one the review takes, and the caller is a
 * reviewer, holds one of `agentRoles`, or the review names no `agentRoles`.
 *
 * @group Review
 */
export function mayPropose(roles: readonly string[], review: CollectionReview, operation: StagedChangeOperation): boolean {
    if (review.mode !== "staged-table") return false;
    if (!(review.operations ?? ["insert", "update", "delete"]).includes(operation)) return false;
    if (!review.agentRoles || review.agentRoles.length === 0) return true;
    return isReviewer(roles, review) || holdsAny(roles, review.agentRoles);
}

/** The data-plane scope an operation needs once it is applied. @group Review */
export function scopeForOperation(operation: StagedChangeOperation): "data:write" | "data:delete" {
    return operation === "delete" ? "data:delete" : "data:write";
}
