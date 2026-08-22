/**
 * The panel's client for live schema editing.
 *
 * Two calls, mirroring the routes: ask what a change would do, then do it. They
 * are deliberately separate here as well as on the server, because a UI that
 * could only try-and-see would be asking somebody to discover that their change
 * is refused by pressing a button on a live database.
 *
 * ## Why this is not wired into the editor's save path
 *
 * The collection editor's existing saves go to the source-only schema editor,
 * and some of them post *partial* payloads — `saveProperty` follows up with a
 * one-key `collection/save` carrying `partial: true`. Live editing needs the
 * whole collection, because it computes the proposed state by replacing one
 * collection in the set: handed a partial, it would read every unmentioned
 * property as a removal and refuse the change.
 *
 * Reconciling that is a UI change with a confirmation step in it, not a
 * substitution. So this is the client that change will use, and the existing
 * save path is untouched until there is something to show the verdict in.
 */

/** What the server says a change would do. Mirrors `SchemaChangePlan`. */
export interface LiveSchemaPlan {
    applicable: boolean;
    verdict: "safe" | "diverges" | "needs-migration";
    changes: Array<{
        kind: string;
        verdict: "safe" | "diverges" | "needs-migration";
        collection: string;
        property?: string;
        detail: string;
        remedy?: string;
    }>;
    statements: string[];
    files: string[];
    message: string;
}

export interface LiveSchemaResult {
    applied: boolean;
    applyError?: string;
    committed: { sha: string; branch: string; files: string[] };
    statements: string[];
    summary: string;
}

/**
 * Why live editing is not available here.
 *
 * Distinguished from an ordinary failure because both are expected states with
 * their own explanation, and a UI should say which rather than showing a
 * stack: a Mongo backend will never support this, and a bundle deployment has
 * no source to edit.
 */
export type LiveSchemaUnavailable =
    | { reason: "unsupported"; message: string }
    | { reason: "no-repository"; message: string };

export class LiveSchemaError extends Error {
    constructor(
        message: string,
        readonly code: string | undefined,
        readonly changes?: LiveSchemaPlan["changes"]
    ) {
        super(message);
        this.name = "LiveSchemaError";
    }
}

const UNAVAILABLE: Record<string, LiveSchemaUnavailable["reason"]> = {
    SCHEMA_EDITING_UNSUPPORTED: "unsupported",
    SCHEMA_EDITING_NO_REPOSITORY: "no-repository"
};

export interface LiveSchemaClientOptions {
    /** Base for the routes, e.g. `https://api.example.com/api/schema`. */
    baseUrl: string;
    getAuthToken?: () => Promise<string | null> | string | null;
    fetchImpl?: typeof fetch;
}

export interface ProposedCollectionChange {
    collectionId: string;
    /**
     * The **whole** collection as it should end up — not a patch. See the
     * module comment: a partial reads as a set of removals.
     */
    collection: Record<string, unknown>;
}

export function createLiveSchemaClient(options: LiveSchemaClientOptions) {
    const doFetch = options.fetchImpl ?? fetch;
    const base = options.baseUrl.replace(/\/$/, "");

    const post = async <T>(path: string, body: ProposedCollectionChange): Promise<T> => {
        const token = await options.getAuthToken?.();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        const response = await doFetch(`${base}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body)
        });

        if (response.ok) return await response.json() as T;

        // Parsed rather than assumed: the server answers a structured error, and
        // the code is what tells an expected refusal from a broken request.
        let payload: { error?: { code?: string; message?: string; details?: { changes?: LiveSchemaPlan["changes"] } } } = {};
        try {
            payload = await response.json() as typeof payload;
        } catch {
            payload = { error: { message: await response.text().catch(() => "") } };
        }

        throw new LiveSchemaError(
            payload.error?.message || `Schema request failed with ${response.status}`,
            payload.error?.code,
            payload.error?.details?.changes
        );
    };

    return {
        /** What the change would do. No side effects. */
        plan: (change: ProposedCollectionChange) => post<LiveSchemaPlan>("/plan", change),

        /** Commit the change, then apply it. */
        apply: (change: ProposedCollectionChange) => post<LiveSchemaResult>("/apply", change)
    };
}

/**
 * Whether an error means live editing is unavailable here, rather than that the
 * change was wrong.
 *
 * Returns the reason so a caller can say which, and `undefined` for anything
 * else — a refused change is not an unavailable feature, and conflating them
 * would hide the refusal that the user needs to read.
 */
export function asUnavailable(err: unknown): LiveSchemaUnavailable | undefined {
    if (!(err instanceof LiveSchemaError) || !err.code) return undefined;
    const reason = UNAVAILABLE[err.code];
    return reason ? { reason, message: err.message } : undefined;
}
