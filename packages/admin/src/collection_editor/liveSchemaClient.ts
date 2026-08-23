/**
 * The panel's client for live schema editing.
 *
 * Three calls, mirroring the routes: ask whether this backend can do it, ask
 * what a change would do, then do it. `plan` and `apply` are deliberately
 * separate here as well as on the server, because a UI that could only
 * try-and-see would be asking somebody to discover that their change is refused
 * by pressing a button on a live database.
 *
 * ## Partial payloads are the caller's problem, not this module's
 *
 * Every call takes the **whole** collection. Live editing computes the proposed
 * state by replacing one collection in the set, so a patch would read as a set
 * of removals — every property it does not mention — and be refused.
 *
 * The editor's own save path posts partials (`saveProperty` follows up with a
 * one-key `collection/save` carrying `partial: true`), so
 * `useLocalCollectionsConfigController` assembles the whole collection before
 * it gets here. Accepting a patch and merging it in this module would put that
 * reconstruction one layer away from the collections it needs to read.
 */

/** A constraint the change asks for that the statements will not carry. */
export interface WithheldConstraint {
    target: string;
    kind: "not-null";
    reason: string;
    remedy: string;
}

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
    /**
     * Applicable, and still not fully enforced.
     *
     * Not a refusal, so it does not belong in `changes` — but it is the one
     * thing on a plan somebody might want to stop and read, so the dialog gives
     * it its own place rather than another bullet in the list.
     */
    withheldConstraints: WithheldConstraint[];
    /**
     * What still has to happen after this lands.
     *
     * Empty almost always. The case it exists for: a project that replays
     * versioned migrations, where applying here changes *this* database and
     * commits `drizzle/schema.sql`, but writes no migration — so the next
     * environment built from migrations would not have the change.
     */
    followUp?: string[];
}

export interface LiveSchemaResult {
    applied: boolean;
    applyError?: string;
    committed: { sha: string; branch: string; files: string[] };
    statements: string[];
    summary: string;
    withheldConstraints: WithheldConstraint[];
    followUp?: string[];
}

/**
 * Whether this backend can edit its schema, and what is missing when it cannot.
 *
 * `canPlan` is separate from `enabled` deliberately: previewing a change needs
 * no repository, so a deployment running from a bundle can still show somebody
 * exactly what their change would do. Greying out the preview as well would be
 * a worse answer than the truth.
 */
export interface LiveSchemaStatus {
    enabled: boolean;
    canPlan: boolean;
    /**
     * Whether *this caller* may apply, as opposed to whether the server can.
     *
     * Applying commits to the repository under an author, and a credential is
     * not an author — so an API key or the service key may preview a change and
     * not make one. Reported here so the panel can grey out the button and say
     * why, rather than letting somebody read a plan, decide, press, and only
     * then be refused.
     */
    canApply: boolean;
    applyRefusedBecause?: string;
    applyRefusedCode?: string;
    repository?: string;
    code?: string;
    reason?: string;
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
        /**
         * Whether this backend can edit its schema.
         *
         * Never throws. Every way of failing to get an answer — a backend too
         * old to have the endpoint, an unreachable one, a session that is not
         * an admin — means the same thing to a caller deciding whether to offer
         * the control, and turning that into an exception each caller has to
         * catch would only produce four copies of this `catch`.
         */
        status: async (): Promise<LiveSchemaStatus> => {
            try {
                const token = await options.getAuthToken?.();
                const response = await doFetch(`${base}/status`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {}
                });
                const body = await response.json().catch(() => ({})) as
                    Partial<LiveSchemaStatus> & { error?: { code?: string; message?: string } };

                if (response.ok) {
                    return {
                        enabled: body.enabled === true,
                        canPlan: body.canPlan === true,
                        // Absent on a backend from before capabilities existed.
                        // Read as "yes" there, because on that server being
                        // through the admin gate *was* the whole permission —
                        // defaulting to no would take the feature away from
                        // every deployment that has not upgraded.
                        canApply: body.canApply ?? body.enabled === true,
                        applyRefusedBecause: body.applyRefusedBecause,
                        applyRefusedCode: body.applyRefusedCode,
                        repository: body.repository,
                        code: body.code,
                        reason: body.reason
                    };
                }
                return {
                    enabled: false,
                    canPlan: false,
                    canApply: false,
                    code: body.error?.code,
                    reason: body.error?.message
                        ?? `The backend refused to say whether its schema is editable (HTTP ${response.status}).`
                };
            } catch (err) {
                return {
                    enabled: false,
                    canPlan: false,
                    canApply: false,
                    reason: err instanceof Error ? err.message : "The backend could not be reached."
                };
            }
        },

        /** What the change would do. No side effects. */
        plan: (change: ProposedCollectionChange) => post<LiveSchemaPlan>("/plan", change),

        /** Commit the change, then apply it. */
        apply: (change: ProposedCollectionChange) => post<LiveSchemaResult>("/apply", change)
    };
}

/** The client's shape, for the hook and the tests that fake it. */
export type LiveSchemaClient = ReturnType<typeof createLiveSchemaClient>;

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

/** The person closed the dialog without applying. Not an error; an answer. */
export class SchemaChangeCancelled extends Error {
    constructor() {
        super("The schema change was not applied.");
        this.name = "SchemaChangeCancelled";
    }
}

/**
 * Was this rejection the person saying no?
 *
 * A save has to *reject* when it is cancelled — resolving would leave the form
 * believing it saved. But a caller that treats every rejection as a failure
 * then reports the user's own choice back to them as an error, which is what
 * the collection editor did: a console error and a red snackbar reading "Error
 * persisting collection: The schema change was not applied."
 *
 * Matched by name rather than `instanceof`, which is unreliable the moment two
 * copies of this module end up in one bundle — the class is then a different
 * identity and every check silently answers false.
 */
export function isSchemaChangeCancelled(err: unknown): boolean {
    return err instanceof Error && err.name === "SchemaChangeCancelled";
}
