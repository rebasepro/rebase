import { useCallback, useMemo } from "react";
import { useApiBase, useApiConfig } from "@rebasepro/app";
import {
    DEFAULT_REVIEW_FUNCTION_NAME,
    type ReviewConfig,
    type StagedChange,
    type StagedChangeListResponse,
    type StagedChangeStatus
} from "../config/types";

/** A failed request, with the server's `error.code` when it sent one. */
export class ReviewRequestError extends Error {
    readonly status: number;
    readonly code: string | undefined;

    constructor(status: number, message: string, code?: string) {
        super(message);
        this.name = "ReviewRequestError";
        this.status = status;
        this.code = code;
    }
}

/** The `error` of an error envelope, when the body is one. */
function errorOf(body: unknown): { message?: string; code?: string } {
    if (typeof body !== "object" || body === null || !("error" in body)) return {};
    const error = body.error;
    if (typeof error !== "object" || error === null) return {};
    return {
        message: "message" in error && typeof error.message === "string" ? error.message : undefined,
        code: "code" in error && typeof error.code === "string" ? error.code : undefined
    };
}

/** A plain object, or a 502 naming what arrived instead. */
function objectOf(value: unknown, what: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ReviewRequestError(502, `The server answered ${what} with something that is not an object.`);
    }
    return Object.fromEntries(Object.entries(value));
}

const STATUSES = new Set(["pending", "approved", "rejected"]);
const OPERATIONS = new Set(["insert", "update", "delete"]);

/** A staged change as the review function sends it, checked field by field. */
export function readStagedChange(value: unknown): StagedChange {
    const row = objectOf(value, "a staged change");
    const text = (key: string): string | null => typeof row[key] === "string" ? String(row[key]) : null;
    const data = (key: string): Record<string, unknown> | null =>
        typeof row[key] === "object" && row[key] !== null && !Array.isArray(row[key]) ? objectOf(row[key], key) : null;
    const operation = text("operation");
    const status = text("status");
    if (!text("id") || !text("collection_slug") || !operation || !OPERATIONS.has(operation) || !status || !STATUSES.has(status)) {
        throw new ReviewRequestError(502, "The server answered with a staged change missing its id, collection, operation or status.");
    }
    return {
        id: String(row.id),
        collection_slug: String(row.collection_slug),
        operation: operation === "insert" ? "insert" : operation === "delete" ? "delete" : "update",
        target_record_id: text("target_record_id"),
        before_data: data("before_data"),
        proposed_data: data("proposed_data"),
        status: status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending",
        actor_type: row.actor_type === "user" ? "user" : "api_key",
        actor_id: text("actor_id"),
        actor_label: text("actor_label"),
        reason: text("reason"),
        reviewed_by: text("reviewed_by"),
        reviewed_at: text("reviewed_at"),
        review_note: text("review_note"),
        created_at: text("created_at") ?? new Date(0).toISOString()
    };
}

/** The `data` array of an answer, as objects. */
function dataArray(body: unknown, what: string): unknown[] {
    const data = objectOf(body, what).data;
    if (!Array.isArray(data)) throw new ReviewRequestError(502, `The server answered ${what} without a data list.`);
    return data;
}

/** A number field of an object, or undefined. */
function numberField(value: unknown, key: string): number | undefined {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    const field: unknown = Reflect.get(value, key);
    return typeof field === "number" ? field : undefined;
}

/** A row of a listing: the `data` array of `GET /data/<slug>`. */
export type ReviewRow = Record<string, unknown>;

/** What the review queue asks the backend. */
export interface ReviewApi {
    /** False until the panel knows where the API is. */
    ready: boolean;
    listChanges(params: { collection: string; status?: StagedChangeStatus; limit?: number }): Promise<StagedChangeListResponse>;
    countChanges(params: { collection: string; status?: StagedChangeStatus }): Promise<number>;
    decide(action: "approve" | "reject", ids: string[], note?: string): Promise<StagedChange[]>;
    /** Rows of a state-field collection in one state. */
    listRowsInState(params: { collection: string; field: string; value: string; limit?: number }): Promise<{ rows: ReviewRow[]; total: number }>;
    /** Set one row's state field: the approval or rejection of a state-field review. */
    setRowState(params: { collection: string; id: string; field: string; value: string }): Promise<void>;
}

/**
 * The review function's routes and the data API, as the signed-in reviewer.
 *
 * Plain requests, made when the queue opens and after each decision: the queue
 * is a list a person works through, not a live view.
 */
export function useReviewApi(config: ReviewConfig): ReviewApi {
    const apiConfig = useApiConfig();
    const apiBase = useApiBase();
    const functionName = config.functionName ?? DEFAULT_REVIEW_FUNCTION_NAME;

    const request = useCallback(async (path: string, init: { method?: string; body?: unknown } = {}): Promise<unknown> => {
        if (!apiBase) throw new ReviewRequestError(0, "The admin panel has no API address configured.");
        const token = await apiConfig?.getAuthToken?.();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;
        const response = await fetch(`${apiBase}${path}`, {
            method: init.method ?? "GET",
            headers,
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        let body: unknown;
        try {
            body = text ? JSON.parse(text) : undefined;
        } catch {
            body = undefined;
        }
        if (!response.ok) {
            const error = errorOf(body);
            throw new ReviewRequestError(response.status, error.message ?? `${response.status} ${response.statusText}`, error.code);
        }
        return body;
    }, [apiBase, apiConfig]);

    return useMemo((): ReviewApi => {
        const fn = `/functions/${encodeURIComponent(functionName)}`;
        return {
            ready: !!apiBase,
            listChanges: async ({ collection, status, limit }) => {
                const query = new URLSearchParams({ collection,
...(status ? { status } : {}),
...(limit ? { limit: String(limit) } : {}) });
                const body = await request(`${fn}/changes?${query}`);
                const data = dataArray(body, "the review queue").map(readStagedChange);
                const meta = objectOf(body, "the review queue").meta;
                const total = numberField(meta, "total") ?? data.length;
                const offset = numberField(meta, "offset") ?? 0;
                return { data,
meta: { total,
limit: numberField(meta, "limit") ?? data.length,
offset,
hasMore: offset + data.length < total } };
            },
            countChanges: async ({ collection, status }) => {
                const query = new URLSearchParams({ collection,
...(status ? { status } : {}) });
                return numberField(await request(`${fn}/changes/count?${query}`), "count") ?? 0;
            },
            decide: async (action, ids, note) => {
                const body = { ...(note ? { note } : {}) };
                if (ids.length === 1) {
                    const answer = await request(`${fn}/changes/${encodeURIComponent(ids[0])}/${action}`, { method: "POST",
body });
                    return [readStagedChange(objectOf(answer, "a decision").data)];
                }
                const answer = await request(`${fn}/changes/batch`, { method: "POST",
body: { ...body,
action,
ids } });
                return dataArray(answer, "a decision").map(readStagedChange);
            },
            listRowsInState: async ({ collection, field, value, limit }) => {
                const query = new URLSearchParams({ [field]: `eq.${value}`,
limit: String(limit ?? 50) });
                const body = await request(`/data/${encodeURIComponent(collection)}?${query}`);
                const rows = dataArray(body, `the "${collection}" listing`).map(row => objectOf(row, "a row"));
                return { rows,
total: numberField(objectOf(body, "a listing").meta, "total") ?? rows.length };
            },
            setRowState: async ({ collection, id, field, value }) => {
                await request(`/data/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method: "PATCH",
body: { [field]: value } });
            }
        };
    }, [apiBase, functionName, request]);
}
