/**
 * The review plugin's configuration and wire types.
 *
 * Headless: this module imports nothing but types, so a collection file the
 * backend loads, the server function and the admin panel can all read one
 * review declaration.
 *
 * @module
 */

/**
 * Review declared through a property on the row itself.
 *
 * Callers held to review may only write rows whose `field` holds
 * `pendingValue`; {@link reviewSecurityRules} turns this into a restrictive
 * Postgres policy, so neither the API nor raw SQL under the user role can skip
 * it. A reviewer approves by setting the field to `approvedValue`.
 *
 * @example
 * ```ts
 * { mode: "state-field", field: "status", pendingValue: "draft", approvedValue: "published", rejectedValue: "rejected", agentRoles: ["agent"] }
 * ```
 *
 * @group Review
 */
export interface StateFieldReview {
    /** Discriminant: review state lives in a property of the row. */
    mode: "state-field";
    /**
     * The property holding the review state. It must be declared on the
     * collection and be a `string`; when it declares `enum` values, every
     * value below must be one of them.
     */
    field: string;
    /**
     * The value a proposed row carries. Callers held to review may only insert
     * rows with this value, and only update rows that hold it and keep it.
     */
    pendingValue: string;
    /** The value a reviewer sets to approve a row. */
    approvedValue: string;
    /**
     * The value a reviewer sets to reject a row. Unset, the review queue offers
     * approval only.
     */
    rejectedValue?: string;
    /**
     * The roles held to `pendingValue`. Unset, every caller that is not a
     * reviewer is: anyone may propose, only a reviewer may approve. The
     * trusted server context and the `admin` role are never held.
     */
    agentRoles?: string[];
    /**
     * The roles that may move a row out of `pendingValue`. The `admin` role
     * always may. A caller holding a role from both lists is a reviewer.
     */
    reviewerRoles?: string[];
}

/**
 * Review through a queue of proposed changes kept beside the table.
 *
 * Proposals are recorded in `rebase.staged_changes` through the plugin's
 * function and applied, in one transaction under the reviewer's own row-level
 * security, when a reviewer approves them. Nothing in the collection moves
 * before that. To make proposing the only way an agent can change the
 * collection, give its key `functions:invoke:review` and no `data:write`.
 *
 * @example
 * ```ts
 * { mode: "staged-table", agentRoles: ["agent"], reviewerRoles: ["editor"] }
 * ```
 *
 * @group Review
 */
export interface StagedTableReview {
    /** Discriminant: changes wait in `rebase.staged_changes` until approved. */
    mode: "staged-table";
    /** Which operations may be proposed. Defaults to all three. */
    operations?: StagedChangeOperation[];
    /**
     * The roles that may propose changes, beside the reviewers. Unset, any
     * signed-in caller may.
     */
    agentRoles?: string[];
    /**
     * The roles that may list, approve and reject this collection's proposals.
     * The `admin` role always may. Approval runs the change under the
     * reviewer's own row-level security.
     */
    reviewerRoles?: string[];
}

/** How one collection's writes are reviewed. @group Review */
export type CollectionReview = StateFieldReview | StagedTableReview;

/**
 * The review plugin's configuration: which collections are reviewed and how.
 * Pass the same object to the server function and to the admin plugin.
 *
 * @group Review
 */
export interface ReviewConfig {
    /** Keyed by collection slug. */
    collections: Record<string, CollectionReview>;
    /**
     * The name the server function is registered under, and so the path it
     * answers at: `/api/functions/<functionName>`. Defaults to `"review"`.
     */
    functionName?: string;
}

/** The write a staged change proposes. @group Review */
export type StagedChangeOperation = "insert" | "update" | "delete";

/** Where a staged change is in its review. @group Review */
export type StagedChangeStatus = "pending" | "approved" | "rejected";

/** Every staged change operation, in display order. @group Review */
export const STAGED_CHANGE_OPERATIONS: readonly StagedChangeOperation[] = ["insert", "update", "delete"];

/** Every staged change status, in display order. @group Review */
export const STAGED_CHANGE_STATUSES: readonly StagedChangeStatus[] = ["pending", "approved", "rejected"];

/** The function name used when {@link ReviewConfig.functionName} is unset. @group Review */
export const DEFAULT_REVIEW_FUNCTION_NAME = "review";

/**
 * One proposed change, as the plugin's routes return it.
 *
 * @group Review
 */
export interface StagedChange {
    id: string;
    /** The collection the change writes to. */
    collection_slug: string;
    operation: StagedChangeOperation;
    /** The row an update or delete addresses; the id an insert asked for, if any. */
    target_record_id: string | null;
    /**
     * The row as the proposer could read it when the change was staged. Null
     * for an insert, and in an answer to a key that may not read the
     * collection.
     */
    before_data: Record<string, unknown> | null;
    /** The values the change writes. Null for a delete. */
    proposed_data: Record<string, unknown> | null;
    status: StagedChangeStatus;
    /** `api_key` for a key, `user` for a signed-in person. */
    actor_type: "api_key" | "user";
    /** The key id or user id that proposed it. */
    actor_id: string | null;
    /** How to name the proposer to a reviewer: a key's prefix and name, or a person's email. */
    actor_label: string | null;
    /** Why the proposer says the change is needed. */
    reason: string | null;
    /** The user id that approved or rejected it. */
    reviewed_by: string | null;
    reviewed_at: string | null;
    /** What the reviewer said, typically on a rejection. */
    review_note: string | null;
    created_at: string;
}

/**
 * What proposing a change takes: `POST /api/functions/review/changes`.
 *
 * @group Review
 */
export interface StageChangeRequest {
    collection: string;
    operation: StagedChangeOperation;
    /** Required for `update` and `delete`. */
    recordId?: string | number;
    /** Required for `insert` and `update`. */
    data?: Record<string, unknown>;
    reason?: string;
}

/**
 * One decision for several changes, applied together:
 * `POST /api/functions/review/changes/batch`.
 *
 * @group Review
 */
export interface StagedChangeBatchRequest {
    action: "approve" | "reject";
    ids: string[];
    /** Recorded on every change in the batch. */
    note?: string;
}

/** A page of staged changes, as `GET /changes` answers. @group Review */
export interface StagedChangeListResponse {
    data: StagedChange[];
    meta: { total: number; limit: number; offset: number; hasMore: boolean };
}
