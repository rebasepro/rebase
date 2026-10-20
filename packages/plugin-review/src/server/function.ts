/**
 * The review function: propose, list, approve and reject staged changes.
 *
 * Registered as a custom function, so it sits behind the functions router's
 * own authentication: every request arrives with its caller resolved and a
 * driver scoped to that caller. A key reaches it only with
 * `functions:invoke` (or `functions:invoke:<name>`).
 *
 * @module
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { getCollectionDataPath, scopeGrants, type BatchWriteOperation, type CollectionConfig, type DataDriver } from "@rebasepro/types";
import { ApiError, getApiKey, getScopes, getUser, rebase, requireDriver, type HonoEnv } from "@rebasepro/server/functions";
import { isReviewer, mayPropose, scopeForOperation } from "../config/access";
import { findReviewConfigProblems } from "../config/validate";
import {
    STAGED_CHANGE_OPERATIONS,
    STAGED_CHANGE_STATUSES,
    type ReviewConfig,
    type StagedChange,
    type StagedChangeListResponse,
    type StagedChangeOperation,
    type StagedChangeStatus,
    type StagedTableReview
} from "../config/types";
import { createStagedChangeStore, isStagedChangeId, type SqlExecutor, type StagedChangeStore } from "./store";

/** The longest `reason` or `note` kept. */
const MAX_TEXT_LENGTH = 2000;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 100;
const MAX_BATCH = 100;

/** Options for {@link reviewFunction}. @group Review */
export interface ReviewFunctionOptions {
    /**
     * How statements reach the owner connection. Defaults to `rebase.sql` of
     * the backend serving the request; pass one to run the store elsewhere,
     * or in a test.
     */
    sql?: SqlExecutor;
}

type ReviewContext = Context<HonoEnv>;

/** The staged-table reviews of a configuration, by slug. */
function stagedReviews(config: ReviewConfig): Map<string, StagedTableReview> {
    const reviews = new Map<string, StagedTableReview>();
    for (const [slug, review] of Object.entries(config.collections)) {
        if (review.mode === "staged-table") reviews.set(slug, review);
    }
    return reviews;
}

/** A narrowed credential's grant, or the whole data plane for a person's own session. */
function grants(scopes: string[] | undefined, scope: string, slug: string): boolean {
    return scopes === undefined || scopeGrants(scopes, scope, slug);
}

/** A body as an object, or a 400. */
async function jsonBody(c: ReviewContext): Promise<Record<string, unknown>> {
    const raw = await c.req.text();
    if (!raw.trim()) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new ApiError(400, "BAD_REQUEST", "Invalid JSON body");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new ApiError(400, "BAD_REQUEST", "The request body must be a JSON object.");
    }
    return Object.fromEntries(Object.entries(parsed));
}

/** A trimmed, capped string, or null. */
function optionalText(value: unknown): string | null {
    return typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, MAX_TEXT_LENGTH) : null;
}

/** A bounded non-negative integer from a query parameter. */
function pageNumber(value: string | undefined, fallback: number, max: number): number {
    const parsed = value === undefined ? NaN : Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
}

/**
 * The review function, ready to register.
 *
 * @example
 * ```ts
 * // functions/review.ts
 * import { reviewFunction } from "@rebasepro/plugin-review/server";
 * import { review } from "../config/review";
 *
 * export default reviewFunction(review);
 * ```
 *
 * Routes, under `/api/functions/review`:
 *
 * - `POST /changes` — propose a change (`StageChangeRequest`). Nothing in the
 *   collection moves.
 * - `GET /changes?collection=&status=&limit=&offset=` — the changes the caller
 *   reviews, and the caller's own proposals.
 * - `GET /changes/count?collection=&status=` — how many of those there are.
 * - `POST /changes/:id/approve`, `POST /changes/:id/reject` — decide one,
 *   with an optional `{ note }`.
 * - `POST /changes/batch` — decide several (`StagedChangeBatchRequest`); an
 *   approval applies every change in one transaction or none of them.
 *
 * @group Review
 */
export function reviewFunction(config: ReviewConfig, options: ReviewFunctionOptions = {}): Hono<HonoEnv> {
    const reviews = stagedReviews(config);
    const sql: SqlExecutor = options.sql ?? ((query, params) => rebase.sql(query, params ? { params } : undefined));
    const store: StagedChangeStore = createStagedChangeStore(sql);
    let configChecked = false;

    /** The collection a slug names on the backend serving the request, when it can say. */
    const collectionOf = (c: ReviewContext, slug: string): CollectionConfig | undefined =>
        c.get("services")?.collections().find(collection => collection.slug === slug);

    /** The caller, or a 401; and the configuration checked once against the backend's collections. */
    const prepare = async (c: ReviewContext) => {
        const user = getUser(c);
        if (!user) throw new ApiError(401, "UNAUTHORIZED", "Authentication required");
        const services = c.get("services");
        if (!configChecked && services) {
            const problems = findReviewConfigProblems(config, services.collections());
            if (problems.length > 0) {
                throw new ApiError(500, "REVIEW_CONFIG_INVALID",
                    "The review plugin's configuration does not match this backend's collections: " +
                    problems.map(problem => `${problem.path}: ${problem.message}`).join("; "),
                    { problems });
            }
            configChecked = true;
        }
        await store.ensureTable();
        return { user,
scopes: getScopes(c) };
    };

    /** The staged-table review of a slug, or a 404 naming the ones there are. */
    const reviewOf = (slug: unknown): { slug: string; review: StagedTableReview } => {
        const review = typeof slug === "string" ? reviews.get(slug) : undefined;
        if (typeof slug !== "string" || !review) {
            throw new ApiError(404, "NOT_REVIEWED",
                `"${String(slug)}" has no staged-table review. Reviewed collections: ${[...reviews.keys()].join(", ") || "none"}.`);
        }
        return { slug,
review };
    };

    /** A change as this caller may see it: no snapshot for a key that cannot read the collection. */
    const visible = (scopes: string[] | undefined, change: StagedChange): StagedChange =>
        grants(scopes, "data:read", change.collection_slug) ? change : { ...change,
before_data: null };

    /**
     * Check that the caller may decide every change, and that each is still
     * pending — before anything is written.
     */
    const decidable = (roles: string[], scopes: string[] | undefined, changes: StagedChange[], action: "approve" | "reject") => {
        for (const change of changes) {
            const review = reviews.get(change.collection_slug);
            if (!review || !isReviewer(roles, review)) {
                throw new ApiError(403, "NOT_A_REVIEWER", `You do not review "${change.collection_slug}".`);
            }
            if (action === "approve" && !grants(scopes, scopeForOperation(change.operation), change.collection_slug)) {
                const wanted = `${scopeForOperation(change.operation)}:${change.collection_slug}`;
                throw new ApiError(403, "SCOPE_MISSING", `Approving writes to "${change.collection_slug}", and this credential does not hold "${wanted}".`,
                    { requiredScope: wanted });
            }
            if (change.status !== "pending") {
                throw new ApiError(409, "ALREADY_DECIDED", `Change ${change.id} was already ${change.status}.`);
            }
        }
    };

    /** Apply approved changes in one transaction, under the reviewer's own driver. */
    const apply = async (c: ReviewContext, driver: DataDriver, changes: StagedChange[]) => {
        if (!driver.batchWrite) {
            throw new ApiError(501, "BATCH_UNSUPPORTED", "This backend's data driver cannot apply changes as one transaction.");
        }
        const operations = changes.map((change): BatchWriteOperation => {
            const collection = collectionOf(c, change.collection_slug);
            const path = collection ? getCollectionDataPath(collection) : change.collection_slug;
            const values = change.proposed_data ?? undefined;
            const base = { path,
...(collection ? { collection } : {}) };
            if (change.operation === "insert") {
                return { ...base,
op: "create",
values,
...(change.target_record_id !== null ? { id: change.target_record_id } : {}) };
            }
            if (change.operation === "delete") return { ...base,
op: "delete",
id: change.target_record_id };
            return { ...base,
op: "update",
id: change.target_record_id,
values };
        });
        await driver.batchWrite({ operations });
    };

    /**
     * Decide changes: claim them (so two reviewers cannot both apply one), then
     * for an approval apply them; an approval whose write fails is put back to
     * pending and the failure answered.
     */
    const decide = async (c: ReviewContext, ids: string[], action: "approve" | "reject", note: string | null) => {
        const { user, scopes } = await prepare(c);
        const changes = await store.getMany(ids);
        if (changes.length !== ids.length) {
            const found = new Set(changes.map(change => change.id));
            throw new ApiError(404, "NOT_FOUND", `No staged change ${ids.find(id => !found.has(id.toLowerCase()))}.`);
        }
        decidable(user.roles, scopes, changes, action);
        const driver = requireDriver(c);
        const claimed = await store.decide(ids, {
            status: action === "approve" ? "approved" : "rejected",
            reviewedBy: user.uid,
            note
        });
        if (claimed.length !== changes.length) {
            await store.reopen(claimed.map(change => change.id));
            throw new ApiError(409, "ALREADY_DECIDED", "Another reviewer decided one of these changes first. Reload the queue.");
        }
        if (action === "approve") {
            try {
                await apply(c, driver, changes);
            } catch (error) {
                await store.reopen(claimed.map(change => change.id));
                throw error;
            }
        }
        const order = new Map(ids.map((id, index) => [id.toLowerCase(), index]));
        return claimed.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map(change => visible(scopes, change));
    };

    const app = new Hono<HonoEnv>();

    // Propose.
    app.post("/changes", async (c) => {
        const { user, scopes } = await prepare(c);
        const body = await jsonBody(c);
        const { slug, review } = reviewOf(body.collection);
        const operation = body.operation;
        if (typeof operation !== "string" || !STAGED_CHANGE_OPERATIONS.some(op => op === operation)) {
            throw new ApiError(400, "INVALID_STAGED_CHANGE", "`operation` is \"insert\", \"update\" or \"delete\".");
        }
        const op: StagedChangeOperation = operation === "insert" ? "insert" : operation === "delete" ? "delete" : "update";
        if (!mayPropose(user.roles, review, op)) {
            throw new ApiError(403, "MAY_NOT_PROPOSE", `You may not propose a ${op} on "${slug}".`);
        }
        const recordId = typeof body.recordId === "string" || typeof body.recordId === "number"
            ? String(body.recordId)
            : undefined;
        if (op !== "insert" && !recordId) {
            throw new ApiError(400, "INVALID_STAGED_CHANGE", `A proposed ${op} names the row it changes: \`recordId\`.`);
        }
        let data: Record<string, unknown> | null = null;
        if (op !== "delete") {
            if (typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) {
                throw new ApiError(400, "INVALID_STAGED_CHANGE", `A proposed ${op} carries the values it writes: \`data\`, an object.`);
            }
            data = Object.fromEntries(Object.entries(body.data));
            const collection = collectionOf(c, slug);
            const unknown = collection ? Object.keys(data).filter(key => !(key in collection.properties)) : [];
            if (unknown.length > 0) {
                throw new ApiError(400, "UNKNOWN_FIELD", `"${slug}" has no field ${unknown.map(key => `"${key}"`).join(", ")}.`, { fields: unknown });
            }
        }

        // The row as the proposer can read it: through their own row-level
        // security, so nobody proposes a change to a row they cannot see.
        let before: Record<string, unknown> | null = null;
        if (op !== "insert" && recordId) {
            const collection = collectionOf(c, slug);
            const row = await requireDriver(c).fetchOne({
                path: collection ? getCollectionDataPath(collection) : slug,
                id: recordId,
                ...(collection ? { collection } : {})
            });
            if (!row) throw new ApiError(404, "NOT_FOUND", `No row "${recordId}" in "${slug}".`);
            before = row;
        }

        const apiKey = getApiKey(c);
        const change = await store.insert({
            collection_slug: slug,
            operation: op,
            target_record_id: recordId ?? null,
            before_data: before,
            proposed_data: data,
            actor_type: apiKey ? "api_key" : "user",
            actor_id: apiKey ? apiKey.id : user.uid,
            actor_label: apiKey ? `${apiKey.key_prefix}… · ${apiKey.name}` : user.email ?? user.uid,
            reason: optionalText(body.reason)
        });
        return c.json({ data: visible(scopes, change) }, 201);
    });

    const listFilter = (c: ReviewContext, roles: string[], scopes: string[] | undefined, uid: string, apiKeyId: string | undefined) => {
        const collection = c.req.query("collection");
        if (collection !== undefined) reviewOf(collection);
        const status = c.req.query("status");
        if (status !== undefined && !STAGED_CHANGE_STATUSES.some(known => known === status)) {
            throw new ApiError(400, "BAD_REQUEST", "`status` is \"pending\", \"approved\" or \"rejected\".");
        }
        const reviewable = [...reviews.entries()]
            .filter(([slug, review]) => isReviewer(roles, review) && grants(scopes, "data:read", slug))
            .map(([slug]) => slug);
        const statusFilter: StagedChangeStatus | undefined = status === "pending" || status === "approved" || status === "rejected" ? status : undefined;
        return {
            reviewable,
            actorId: apiKeyId ?? uid,
            ...(collection !== undefined ? { collection } : {}),
            ...(statusFilter ? { status: statusFilter } : {})
        };
    };

    app.get("/changes/count", async (c) => {
        const { user, scopes } = await prepare(c);
        const filter = listFilter(c, user.roles, scopes, user.uid, getApiKey(c)?.id);
        const { total } = await store.list({ ...filter,
limit: 0,
offset: 0 });
        return c.json({ count: total });
    });

    app.get("/changes", async (c) => {
        const { user, scopes } = await prepare(c);
        const filter = listFilter(c, user.roles, scopes, user.uid, getApiKey(c)?.id);
        const limit = pageNumber(c.req.query("limit"), DEFAULT_PAGE, MAX_PAGE);
        const offset = pageNumber(c.req.query("offset"), 0, Number.MAX_SAFE_INTEGER);
        const { changes, total } = await store.list({ ...filter,
limit,
offset });
        const response: StagedChangeListResponse = {
            data: changes.map(change => visible(scopes, change)),
            meta: { total,
limit,
offset,
hasMore: offset + changes.length < total }
        };
        return c.json(response);
    });

    app.post("/changes/batch", async (c) => {
        const body = await jsonBody(c);
        const action = body.action;
        if (action !== "approve" && action !== "reject") {
            throw new ApiError(400, "BAD_REQUEST", "`action` is \"approve\" or \"reject\".");
        }
        const ids = body.ids;
        if (!Array.isArray(ids) || ids.length === 0 || !ids.every(isStagedChangeId)) {
            throw new ApiError(400, "BAD_REQUEST", "`ids` is a non-empty array of staged change ids.");
        }
        if (ids.length > MAX_BATCH) {
            throw new ApiError(400, "BATCH_TOO_LARGE", `At most ${MAX_BATCH} changes in one batch; this one has ${ids.length}.`);
        }
        const unique = [...new Set(ids.map(id => id.toLowerCase()))];
        return c.json({ data: await decide(c, unique, action, optionalText(body.note)) });
    });

    for (const action of ["approve", "reject"] as const) {
        app.post(`/changes/:id/${action}`, async (c) => {
            const id = c.req.param("id");
            if (!isStagedChangeId(id)) throw new ApiError(404, "NOT_FOUND", `No staged change ${id}.`);
            const body = await jsonBody(c);
            const [change] = await decide(c, [id.toLowerCase()], action, optionalText(body.note));
            return c.json({ data: change });
        });
    }

    return app;
}
