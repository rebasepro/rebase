import { policy, type PolicyExpression, type SecurityRule } from "@rebasepro/types";
import type { StateFieldReview } from "./types";

/**
 * The restrictive policy that holds a state-field review.
 *
 * Restrictive policies are ANDed with every other policy on the table, so this
 * narrows what the table's own `rls` grants and never widens it:
 * a caller held to review may insert a row only with `field = pendingValue`,
 * and may update a row only while it holds `pendingValue` and keeps it. The
 * trusted server context, the `admin` role and every reviewer role pass
 * untouched; with `agentRoles` set, so does every caller holding none of them.
 *
 * Spread it into the table's `rls`:
 *
 * @example
 * ```ts
 * // backend/schema/posts.ts
 * import { col, defineTable } from "@rebasepro/server/schema";
 * import { reviewRls } from "@rebasepro/plugin-review/config";
 * import { review } from "../review";
 *
 * export const posts = defineTable("posts", {
 *     columns: {
 *         id: col.uuid().primaryKey().defaultRandom(),
 *         status: col.enum(["draft", "published", "rejected"]).notNull().default("draft"),
 *         …
 *     },
 *     rls: [
 *         { operations: ["select", "insert", "update"], roles: ["agent", "editor"] },
 *         ...reviewRls("posts", review.collections.posts)
 *     ]
 * });
 * ```
 *
 * The policy's name is derived from the slug, `<slug>_review_pending_only`
 * (`-` written `_`), so it is the same on every push and every machine.
 *
 * @group Review
 */
export function reviewRls(slug: string, review: StateFieldReview): SecurityRule[] {
    const exempt: PolicyExpression[] = [
        policy.serverContext(),
        policy.rolesOverlap(["admin", ...(review.reviewerRoles ?? [])])
    ];
    if (review.agentRoles && review.agentRoles.length > 0) {
        exempt.push(policy.not(policy.rolesOverlap(review.agentRoles)));
    }
    const pending = policy.compare(policy.field(review.field), "eq", policy.literal(review.pendingValue));
    const held = policy.or(...exempt, pending);
    return [{
        name: `${slug.replace(/-/g, "_")}_review_pending_only`,
        mode: "restrictive",
        operations: ["insert", "update"],
        condition: held,
        check: held
    }];
}
