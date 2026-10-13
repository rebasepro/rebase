import { AggregateParams, FindParams as TypesFindParams, FindResponse as TypesFindResponse, IMPERSONATE_HEADER, type IncludeSpec, RebaseApiError, SCHEMA_VERSION_HEADER } from "@rebasepro/types";
import { RESERVED_QUERY_KEYS, resolveFindWindow, serializeFilter, serializeInclude, serializeLogicalCondition, serializeOrderBy } from "@rebasepro/common";
import { parseRebaseJson } from "./reviver";

// The canonical client error now lives in `@rebasepro/types` so every package
// (client, auth, …) throws one type. Re-exported here to preserve the historical
// `import { RebaseApiError } from ".../transport"` path used across the SDK.
export { RebaseApiError } from "@rebasepro/types";
export type { RebaseErrorInit } from "@rebasepro/types";
import { RebaseClientError } from "@rebasepro/types";

export interface RebaseClientConfig {
    /**
     * Origin of the Rebase server — scheme, host and port **only**.
     *
     * {@link apiPath} is appended to this, so do not include it here:
     * `"http://localhost:3001"` is correct, while `"http://localhost:3001/api"`
     * silently builds `/api/api/…` and every request 404s. Omit entirely for
     * same-origin requests from the browser.
     */
    baseUrl?: string;
    /**
     * Bearer token sent as `Authorization` on every request.
     *
     * In the browser this is the signed-in user's access token, so row-level
     * security applies. Server-side callers — scripts, cron jobs, ETL — pass the
     * service key instead, which resolves to `{ uid: "service", roles: ["admin"] }`
     * and **bypasses RLS**: there is no user to constrain those queries, so scope
     * them explicitly.
     */
    token?: string;
    /**
     * Path the API is mounted under, appended to {@link baseUrl}.
     * Defaults to `"/api"`; override only if the server mounts it elsewhere.
     */
    apiPath?: string;
    /**
     * Origin to use instead of {@link baseUrl} for URLs that are handed to the
     * browser to fetch on its own — storage file downloads and previews.
     *
     * API *requests* always go to `baseUrl`; this only changes URLs the SDK
     * *returns* (e.g. `storage.getSignedUrl`). It exists for proxied setups:
     * when `baseUrl` routes through an authenticated middleman (the Rebase
     * console's Studio proxy), a plain `<img src>` or a copied link cannot
     * satisfy the middleman's auth — but the file route itself is reachable
     * directly at the origin server and secured by its own scoped `?token=`.
     * Set this to that server's public origin (no path; {@link apiPath} is
     * appended) and returned file URLs point straight at it.
     */
    storageUrlOrigin?: string;
    fetch?: typeof globalThis.fetch;
    onUnauthorized?: () => Promise<boolean>;
    websocketUrl?: string; // Optional real-time WebSocket connection
    /**
     * Open the realtime WebSocket. **Defaults to `true`.**
     *
     * The socket connects as soon as the client is constructed and keeps the
     * Node event loop alive, so a one-shot script (CLI, cron job, ETL) will not
     * exit on its own. Set this to `false` for any process that reads or writes
     * and then terminates — `.listen()` and `.listenById()` then throw instead
     * of silently doing nothing.
     *
     * Long-lived processes that do want realtime can instead call
     * `client.close()` when shutting down.
     */
    realtime?: boolean;
    /**
     * "Yes, I meant to be anonymous."
     *
     * Off-browser, a client with no credential can only ever call as an
     * anonymous user, and row-level security answers it with whatever is
     * public — usually nothing. That is almost always a mistake in a script or
     * cron job, so the SDK warns once on the first request (see
     * {@link ANONYMOUS_SERVER_CLIENT_WARNING}). Anonymous is a legitimate
     * choice for public reads, though; set this to `true` to say so and
     * silence the warning.
     *
     * Has no effect in the browser, where anonymous-before-sign-in is normal
     * and nothing is ever warned about.
     */
    anonymous?: boolean;
    /**
     * The schema this client was generated against, sent as `x-rebase-schema`.
     *
     * `rebase generate-sdk` writes the value into `schema.meta.ts` as
     * `SCHEMA_VERSION`; pass it here and every request carries it. Advisory —
     * nothing is ever refused for it — but it is what lets a server say "this
     * client was built against a schema three deploys old" instead of
     * answering a renamed field with a bare 400.
     *
     * The compatibility matrix has listed this header as something the SDK
     * sends since it was written. Nothing sent it: the constant existed, the
     * server echoed it back on two routes, and no client ever put it on a
     * request. This is the missing half.
     */
    schemaVersion?: string;
    /**
     * Headers added to every request, beneath any per-request `headers`.
     *
     * For identifying the caller, not for authenticating it — the CLI uses it
     * to send `User-Agent: rebase-cli/<version>`, which is what a control plane
     * needs before it can refuse a CLI that is too old by name. `Authorization`
     * is not settable here; it always comes from the token.
     */
    headers?: Record<string, string>;
    /**
     * Run every request as this user, named by uid: sent as
     * `x-rebase-impersonate` on each HTTP request, and with the realtime
     * socket's sign-in.
     *
     * For checking what one user can see and do against the real row-level
     * security, as Studio's API explorer and JS editor do. Only an
     * administrator's own session may — the server refuses it for anyone
     * else, and always for an API key or the service key. The data API,
     * custom functions and realtime run as the named user; every other route
     * refuses the request rather than answer as the administrator.
     */
    impersonate?: string;
}

/**
 * Facts about the surrounding client that the transport cannot read off its own
 * config, but needs in order to decide whether a request is *meaningfully*
 * credential-less.
 */
export interface TransportEnvironment {
    /**
     * The credential reaches the server without an `Authorization` header —
     * i.e. `auth.authFlowMode: "cookie"`, where the refresh token lives in an
     * httpOnly cookie. Such a client looks tokenless to the transport but is
     * not anonymous, so it must never trip the guard.
     */
    credentialOutOfBand?: boolean;
}

/**
 * True when there is no browser to have signed a user in — a Node script, a
 * cron job, an edge worker.
 *
 * Anonymous is an ordinary, correct state in a browser: before sign-in, on a
 * marketing page, for public reads. Warning there would be noise that teaches
 * people to ignore warnings, so the guard is off entirely. This uses the same
 * `typeof window` test as {@link resolveBaseUrl}, and additionally treats a
 * defined `document` as a browser so an SSR shim or test harness that installs
 * only one of the two is still excluded.
 */
function isServerLikeEnvironment(): boolean {
    return typeof window === "undefined" && typeof document === "undefined";
}

/**
 * Emitted once per client. Kept as a constant so the wording is testable and
 * greppable — this is the string a user will paste into a search.
 */
export const ANONYMOUS_SERVER_CLIENT_WARNING =
    "[rebase] This client was created outside a browser with no credential — no `token`, no auth token getter, "
    + "and no cookie auth flow — so every request runs as an anonymous caller. Row-level security will return only "
    + "publicly readable rows, which is usually nothing and occasionally the wrong thing. "
    + "Inside a cron or function handler, use the `rebase` you were handed instead of building a new one: its data "
    + "plane is already admin-scoped. In a standalone script or job, pass the service key as `token`. "
    + "If you really do want anonymous access, pass `anonymous: true` to silence this.";

/**
 * Re-exported from `@rebasepro/types` so an SDK consumer can name the type of a
 * call it is already making without a second dependency.
 *
 * Forwards the row type: without the parameter this alias flattened
 * `FindParams<M>` back to its `Record<string, unknown>` default, and `where` /
 * `orderBy` went back to accepting any column name — the alias, not the
 * definition, was where the typing was lost.
 */
export type FindParams<M extends Record<string, unknown> = Record<string, unknown>, Inc = IncludeSpec> = TypesFindParams<M, Inc>;
export type FindResponse<T> = TypesFindResponse<T extends Record<string, unknown> ? T : Record<string, unknown>>;

/**
 * Refuse a filter whose *value* is missing.
 *
 * `where: { status: ["==", undefined] }` used to serialize to the literal
 * string, so `status=eq.undefined` went out on the wire and the server dutifully
 * looked for rows whose status is the four-letter word "undefined". The caller
 * saw an empty page, not an error — the classic shape of a variable that was
 * never set.
 *
 * Dropping the condition instead would be worse than sending it: the query
 * would come back *unfiltered*, which for an ownership or tenant filter means
 * returning rows the caller never asked to see. So this is a hard error, and
 * both correct spellings are named in the message: omit the key to skip the
 * filter, or use `["is-null", null]` to match SQL NULL (which still
 * serializes — `null` is a value, `undefined` is the absence of one).
 */
export function assertNoUndefinedFilterValues(where: Record<string, unknown>): void {
    const reject = (field: string, op: unknown): never => {
        throw new RebaseClientError(
            `Filter on "${field}" has an undefined value (["${String(op)}", undefined]). `
            + `Omit "${field}" from \`where\` to skip the filter, or use ["is-null", null] to match SQL NULL.`,
            { code: "INVALID_FILTER", details: { field, operator: String(op) } }
        );
    };

    for (const [field, condition] of Object.entries(where)) {
        // An entirely absent condition is the documented way to skip a filter.
        if (condition === undefined) continue;
        if (!Array.isArray(condition)) continue;

        // Either one `[op, value]` tuple or an array of them.
        const tuples = Array.isArray(condition[0]) ? condition as unknown[][] : [condition as unknown[]];
        for (const tuple of tuples) {
            if (!Array.isArray(tuple) || tuple.length !== 2) continue;
            const [op, value] = tuple;
            if (value === undefined) reject(field, op);
            // `["in", [...]]` — a hole in the list is the same mistake.
            if (Array.isArray(value) && value.some(v => v === undefined)) reject(field, op);
        }
    }
}

/**
 * A find's parameters as `[name, value]` pairs, in the order the URL carries
 * them, values not yet URL-encoded.
 *
 * One list for both spellings of a listing: {@link buildQueryString} encodes it
 * into the `GET`'s URL, and {@link buildQueryBody} gathers it into the body of
 * `POST …/query`, which the server turns back into exactly these parameters.
 * Two serializers would be two chances to send a query one way and not the
 * other.
 */
function findParamPairs(params?: FindParams, deleted?: SoftDeletedRows): [string, string][] {
    const pairs: [string, string][] = [];
    // First, so a trash read is recognisable at a glance in a log line.
    if (deleted) pairs.push(["deleted", deleted]);
    if (!params) return pairs;
    // Refuses `page` with `offset` (`PAGE_WITH_OFFSET`) before any request,
    // with the code the server would answer.
    resolveFindWindow(params);

    if (params.limit != null) pairs.push(["limit", String(params.limit)]);
    if (params.offset != null) pairs.push(["offset", String(params.offset)]);
    if (params.page != null) pairs.push(["page", String(params.page)]);
    // The opaque keyset cursor, passed straight back. Nothing on this side
    // reads it: the encoding is the server's, and a client that parsed it would
    // be depending on something that exists to be changed.
    if (params.after) pairs.push(["after", params.after]);
    // Only `none`: `exact` is the server's default, so sending it says
    // nothing — and a server older than the parameter reads any `?count=` as
    // a filter on a column named `count` (see `find` in collection.ts).
    if (params.count === "none") pairs.push(["count", "none"]);

    if (params.orderBy) {
        const wire = serializeOrderBy(params.orderBy);
        if (wire) pairs.push(["orderBy", wire]);
    }

    if (params.searchString) {
        pairs.push(["searchString", params.searchString]);
        if (params.searchExplain) pairs.push(["searchExplain", "true"]);
    }

    // The server keys vector search off `vector_search` naming the property and
    // `vector` carrying the embedding as a JSON array; both must be present or
    // it ignores the pair entirely.
    if (params.vectorSearch) {
        const vs = params.vectorSearch;
        pairs.push(["vector_search", vs.property]);
        pairs.push(["vector", JSON.stringify(vs.vector)]);
        if (vs.distance) pairs.push(["vector_distance", vs.distance]);
        if (vs.threshold !== undefined) pairs.push(["vector_threshold", String(vs.threshold)]);
    }

    // Through the shared codec, which picks the wire spelling: comma-separated
    // dotted paths when no relation carries options, JSON when one does. The
    // server accepts both and tells them apart the same way. Joining an array
    // here — which is what this did — could not express the tree at all.
    const include = serializeInclude(params.include);
    if (include) pairs.push(["include", include]);

    if (params.fields && params.fields.length > 0) {
        pairs.push(["fields", params.fields.join(",")]);
    }

    // Only when true. `?distinct=false` is the default and sending it says
    // nothing, while the server refuses anything that is neither.
    if (params.distinct) pairs.push(["distinct", "true"]);

    if (params.logical) {
        const root = params.logical;
        const serialized = (root.conditions ?? []).map(serializeLogicalCondition).join(",");
        pairs.push([root.type, `(${serialized})`]);
    }

    if (params.where) appendWhere(pairs, params.where);

    return pairs;
}

const encodePairs = (pairs: [string, string][]): string =>
    pairs.length > 0
        ? "?" + pairs.map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`).join("&")
        : "";

/**
 * `?deleted=` — which soft-deleted rows a read covers: `"only"` the trashed
 * ones, `"include"` live and trashed together. Absent, the server hides them.
 *
 * Not a {@link FindParams} field: `FindParams` is also what `listen()` and the
 * offline cache take, and neither can answer for a trashed row — a
 * subscription has no `withDeleted`, and the local database never holds one.
 * Only the trash accessor (`client.data.<slug>.trash`) passes it.
 */
export type SoftDeletedRows = "include" | "only";

export function buildQueryString(params?: FindParams, deleted?: SoftDeletedRows): string {
    return encodePairs(findParamPairs(params, deleted));
}

/**
 * The body of `POST /data/<collection>/query`: the parameters
 * {@link buildQueryString} puts in the URL, spelled as the URL spells them —
 * each value a string, and a parameter the URL repeats (a filter with two
 * conditions on one field) a list of them. The server reads it back into the
 * same parameters and runs the same listing.
 */
export function buildQueryBody(params?: FindParams, deleted?: SoftDeletedRows): Record<string, string | string[]> {
    const body: Record<string, string | string[]> = {};
    for (const [name, value] of findParamPairs(params, deleted)) {
        const held = body[name];
        body[name] = held === undefined ? value : [...(Array.isArray(held) ? held : [held]), value];
    }
    return body;
}

/**
 * Append a `where` to a query string, one `?<field>=<op>.<value>` parameter per
 * condition.
 *
 * Except on a column whose name the server reads as a parameter of its own —
 * `page`, `select`, `hard`, `where` ({@link RESERVED_QUERY_KEYS}). A filter on
 * such a column sent as its own parameter is read as that parameter, and the
 * filter is never applied. Those conditions go inside `?where=` instead, in the
 * same dot-string spelling, which the server decodes through the same codec and
 * merges in. A collection with no such column sends exactly what it did before.
 */
function appendWhere(pairs: [string, string][], where: Record<string, unknown>): void {
    assertNoUndefinedFilterValues(where);
    const serialized = serializeFilter(where);
    const reserved: Record<string, string | string[]> = {};
    for (const [field, value] of Object.entries(serialized)) {
        if (RESERVED_QUERY_KEYS.has(field)) {
            reserved[field] = value;
            continue;
        }
        for (const v of Array.isArray(value) ? value : [value]) pairs.push([field, v]);
    }
    if (Object.keys(reserved).length > 0) {
        pairs.push(["where", JSON.stringify(reserved)]);
    }
}

/**
 * The query string for `GET /<collection>/aggregate`.
 *
 * `?select=sum(total),count()` is SQL's spelling, because whoever writes an
 * aggregate is thinking in SQL and any other spelling has to be learned first —
 * and because it is what the route already parses. The filters are serialised
 * by exactly the same code a `find()` uses, so "revenue by status, this month"
 * narrows the same rows whichever call is asking.
 *
 * `include` and a cursor are deliberately not here: an aggregate has no
 * relations to load and no row to continue after. `limit`, `offset` and
 * `orderBy` are, and page and sort the *groups* — `orderBy` by a group column or
 * an aggregate's alias, in the spelling a `find()` sends.
 */
export function buildAggregateQueryString<M extends Record<string, unknown>>(params: AggregateParams<M>): string {
    const pairs: [string, string][] = [];

    const select = params.select
        .map(entry => `${entry.fn}(${(entry as { field?: string }).field ?? ""})`)
        .join(",");
    pairs.push(["select", select]);

    if (params.groupBy && params.groupBy.length > 0) {
        pairs.push(["groupBy", params.groupBy.join(",")]);
    }
    if (params.limit != null) pairs.push(["limit", String(params.limit)]);
    if (params.offset != null) pairs.push(["offset", String(params.offset)]);
    if (params.orderBy) {
        const wire = serializeOrderBy(params.orderBy);
        if (wire) pairs.push(["orderBy", wire]);
    }
    if (params.searchString) {
        pairs.push(["searchString", params.searchString]);
    }
    if (params.logical) {
        const root = params.logical;
        const serialized = (root.conditions ?? []).map(serializeLogicalCondition).join(",");
        pairs.push([root.type, `(${serialized})`]);
    }
    if (params.where) appendWhere(pairs, params.where);

    return encodePairs(pairs);
}

/**
 * The 401 codes that mean "the credential on this request is no good", which a
 * refreshed token can fix.
 *
 * The rest of the 401s are answers about something the caller *sent*: a wrong
 * current password (`INVALID_CREDENTIALS`), a mistyped MFA code (`INVALID_CODE`,
 * `CHALLENGE_EXHAUSTED`), a sign-in that needs a second factor
 * (`MFA_REQUIRED`). Refreshing and resending one of those rotated the session
 * for nothing, sent the same wrong answer twice — and an MFA challenge claims
 * an attempt before it judges the code, so every typo cost two of its five.
 */
const TOKEN_REFUSAL_CODES = new Set(["UNAUTHORIZED", "INVALID_TOKEN", "TOKEN_EXPIRED", "SESSION_REVOKED"]);

/**
 * Whether a 401's body says the token was the problem.
 *
 * A 401 with no code at all counts: it is what an older server, a proxy or
 * anything not speaking the envelope sends, and there the token is the
 * likeliest cause — refreshing is what this client always did with it.
 */
function isTokenRefusal(body: Record<string, unknown>): boolean {
    const error = body?.error;
    const code = error && typeof error === "object" ? (error as Record<string, unknown>).code : undefined;
    return typeof code !== "string" || code === "" || TOKEN_REFUSAL_CODES.has(code);
}

/**
 * Response metadata a caller can ask for, filled in by `request`.
 *
 * An out-parameter rather than a second return value, because every one of the
 * fifty-odd call sites wants the body and nothing else, and changing the return
 * shape would mean rewriting all of them to reach past a wrapper. It is also
 * why this is a third *optional* parameter: a `Transport` stub in a test that
 * ignores it is still a valid `Transport`.
 *
 * Only `ETag` for now, and only because a row's version is not part of the row.
 * It cannot be: adding it as a column would put it in the generated `Row` type,
 * in every `find()` result, in the offline cache and in what a caller sends
 * back on the next write — a field the server would then have to strip. The
 * header is where HTTP puts it, so the header is where this reads it.
 */
export interface ResponseMeta {
    /** The `ETag` header, when the response carried one. */
    etag?: string;
    /** The HTTP status, for a caller that has to tell 200 from 204. */
    status?: number;
    /**
     * The response's headers, for a protocol that answers in them — a
     * resumable upload's `Location` and `Upload-Offset`.
     */
    headers?: { get(name: string): string | null };
}

/** See {@link Transport.setTokenRefresher}. */
export type TokenRefresher = () => Promise<string | undefined> | undefined;

export interface Transport {
    request: <T = unknown>(path: string, init?: RequestInit, meta?: ResponseMeta) => Promise<T>;
    /**
     * Like `request`, but the body of a success is left unread: the response
     * comes back as it arrived, for a caller that wants text, a Blob or a
     * stream. Auth, the refresh-and-resend and the error envelope are the same.
     * Optional so a hand-written transport need not have it.
     */
    requestRaw?: (path: string, init?: RequestInit, meta?: ResponseMeta) => Promise<Response>;
    setToken: (newToken: string | null) => void;
    setAuthTokenGetter: (getter: () => Promise<string | null>) => void;
    setOnUnauthorized: (handler: () => Promise<boolean>) => void;
    /**
     * Install the hook asked, before each request that carries this
     * transport's own token, whether that token is known to be spent. It
     * answers `undefined` to send the token as held, or a promise for the one
     * to send instead — the auth module's refresh, so a request made while a
     * session is being restored, or after its token expired unnoticed, goes
     * out once with a good token rather than with none or a dead one.
     *
     * Not consulted when an auth token getter is installed: the getter owns
     * the token then. Optional so a hand-written transport need not have it.
     */
    setTokenRefresher?: (refresher: TokenRefresher | null) => void;
    readonly baseUrl: string;
    readonly apiPath: string;
    /** See {@link RebaseClientConfig.storageUrlOrigin}. Undefined = use `baseUrl`. */
    readonly storageUrlOrigin?: string;
    readonly fetchFn: typeof globalThis.fetch;
    getHeaders: (init?: RequestInit) => Record<string, string>;
    resolveToken: () => Promise<string | null>;
}

/**
 * The base every request and every caller-built URL resolves against.
 *
 * `baseUrl` is optional because the common production shape is a Rebase
 * backend serving its own SPA, where the API is simply the page's origin.
 * Leaving it unset is therefore the *correct* configuration there — and the
 * one that keeps working when a second hostname (a custom domain) points at
 * the same app.
 *
 * When unset in a browser this resolves to the page origin rather than "".
 * Requests behave identically either way, but the empty string is a trap for
 * anything that builds a URL from `client.baseUrl`: `new URL("" + path)`
 * throws, so apps "fixed" it by baking an absolute host into their bundle —
 * which is exactly what breaks the day a custom domain is added, and which no
 * amount of CORS configuration repairs, because a SameSite=Lax auth cookie is
 * not sent cross-site either.
 */
/**
 * The code an error carries when the response did not name one: a proxy's 413,
 * a load balancer's 502, a crash page's 500 — anything without the server's
 * envelope. Without it `e.code` was `undefined` and the documented
 * `switch (e.code)` fell through to `default` on exactly the failures that are
 * not Rebase's own. Only codes the backend itself answers with, so a switch
 * written against the error reference catches both.
 *
 * @internal
 */
export function defaultCodeForStatus(status: number): string | undefined {
    switch (status) {
        case 400: return "BAD_REQUEST";
        case 401: return "UNAUTHORIZED";
        case 403: return "FORBIDDEN";
        case 404: return "NOT_FOUND";
        case 409: return "CONFLICT";
        case 412: return "PRECONDITION_FAILED";
        case 413: return "PAYLOAD_TOO_LARGE";
        case 415: return "UNSUPPORTED_MEDIA_TYPE";
        case 429: return "RATE_LIMITED";
        case 502: case 503: case 504: return "SERVICE_UNAVAILABLE";
        default: return status >= 500 && status < 600 ? "INTERNAL_ERROR" : undefined;
    }
}

function resolveBaseUrl(configured?: string): string {
    if (configured) return configured.replace(/\/$/, "");
    if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
    return "";
}

export function createTransport(config: RebaseClientConfig, environment?: TransportEnvironment): Transport {
    const rawFetch = config.fetch || globalThis.fetch;

    /**
     * `fetch`, but its rejection is a `RebaseApiError` like everything else
     * this client throws.
     *
     * A transport failure — DNS, a refused connection, CORS, an aborted
     * request — rejects with whatever the runtime's `fetch` felt like: a
     * `TypeError` reading "Failed to fetch" in a browser, a `TypeError` with a
     * `cause` in undici, a `DOMException` on abort. So the one class the SDK
     * documents as "a `catch` block only ever needs to check for this" did not
     * cover the most common failure of all, and `e.status` / `e.code` were
     * undefined on the error every app hits first: the server being down.
     *
     * `status: 0` rather than a made-up 5xx. There was no response, and 0 is
     * how `XMLHttpRequest` has always spelled that; a fabricated 503 would be
     * indistinguishable from one the server actually sent. The original error
     * is on `cause`, so nothing is hidden.
     *
     * Wrapped once, at construction, because the request path reads `fetchFn`
     * twice — the first attempt and the post-refresh retry — and a wrapper
     * applied at one call site is a wrapper missing from the other.
     */
    const fetchFn: typeof globalThis.fetch = async (input, init) => {
        try {
            return await rawFetch(input, init);
        } catch (e) {
            if (e instanceof RebaseApiError) throw e;
            const url = typeof input === "string" ? input : String((input as Request).url ?? input);
            // No `baseUrl`, outside a browser: the URL is relative, and there
            // is no page origin for `fetch` to resolve it against. That is a
            // configuration error, not the server being unreachable — said as
            // a network failure, it sent people looking for a server that was
            // never the problem.
            if (!/^[a-z][a-z0-9+.-]*:/i.test(url) && typeof window === "undefined") {
                throw new RebaseClientError(
                    `This client has no \`baseUrl\`, and outside a browser the relative URL ${url} cannot be fetched. ` +
                    "Pass `baseUrl` (e.g. \"http://localhost:3001\") to createRebaseClient().",
                    { code: "BASE_URL_REQUIRED", cause: e }
                );
            }
            throw new RebaseApiError(
                `Could not reach the server at ${url}: ${e instanceof Error ? e.message : String(e)}`,
                { status: 0, code: "NETWORK_ERROR", cause: e }
            );
        }
    };

    const apiPath = config.apiPath || "/api";

    // `apiPath` is appended to `baseUrl`, so a `baseUrl` that already ends in it
    // builds `/api/api/…` and every request 404s. That was documented on
    // `baseUrl` and left to be discovered at runtime — including by this
    // package's own tests, which configured it that way a dozen times. A 404 on
    // every call looks like a server that is down, not like a doubled path.
    // `storageUrlOrigin` is checked alongside it because `storage.ts` composes
    // it the same way — `${storageUrlOrigin ?? baseUrl}${apiPath}` — and its own
    // docblock carries the same "no path" caveat.
    for (const field of ["baseUrl", "storageUrlOrigin"] as const) {
        const value = config[field];
        if (!value || !apiPath) continue;
        const trimmed = value.replace(/\/+$/, "");
        if (!trimmed.endsWith(apiPath)) continue;
        console.warn(
            `[Rebase] ${field} ${JSON.stringify(value)} already ends with the API path ` +
            `${JSON.stringify(apiPath)}, which is appended to it — requests will go to ` +
            `${trimmed}${apiPath}/… and 404. Pass the origin only ` +
            `(${JSON.stringify(trimmed.slice(0, trimmed.length - apiPath.length) || "/")}), or set ` +
            "`apiPath` if the server really does mount the API one level deeper."
        );
    }
    let token = config.token;
    let tokenGetter: (() => Promise<string | null>) | undefined;
    let tokenRefresher: TokenRefresher | undefined;
    let onUnauthorizedHandler = config.onUnauthorized;
    /** Once per client, never per request — log spam is its own bug. */
    let anonymousWarningIssued = false;

    /**
     * Warn a server-side caller that it built a client that can only ever be
     * anonymous. Deliberately checked at the *first request* rather than at
     * construction: `setToken()` / `setAuthTokenGetter()` and a server-side
     * `auth.signIn…()` (which calls `transport.setToken`) all land after the
     * constructor, and warning at construction would fire on every one of them.
     */
    function warnIfAnonymousServerClient(activeToken: string | undefined): void {
        if (anonymousWarningIssued) return;
        if (activeToken) return;                          // a credential is being sent
        if (tokenGetter) return;                          // a credential is being fetched per request
        if (config.anonymous) return;                     // "yes, I meant this"
        if (environment?.credentialOutOfBand) return;     // cookie auth flow — credential is not a header
        if (!isServerLikeEnvironment()) return;           // browsers are legitimately anonymous
        anonymousWarningIssued = true;
        console.warn(ANONYMOUS_SERVER_CLIENT_WARNING);
    }

    // Built once, and applied *under* `Authorization`: a default header set
    // that could overwrite the token would turn a caller's convenience into an
    // authentication bug.
    const defaultHeaders: Record<string, string> = {
        ...(config.headers ?? {}),
        ...(config.schemaVersion ? { [SCHEMA_VERSION_HEADER]: config.schemaVersion } : {}),
        ...(config.impersonate !== undefined ? { [IMPERSONATE_HEADER]: config.impersonate } : {})
    };

    function getHeaders(activeToken: string | undefined, init?: RequestInit): Record<string, string> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            ...defaultHeaders,
            ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
            ...((init?.headers as Record<string, string>) || {})
        };
        // A FormData body needs the multipart Content-Type that fetch writes
        // itself, boundary included; any other value leaves the server unable
        // to find the parts. Here rather than at a call site, because the
        // request path builds headers twice — the first attempt and the
        // post-refresh retry — and the retry was the one without it: an upload
        // whose token had expired came back "No file provided".
        if (init?.body instanceof FormData) delete headers["Content-Type"];
        return headers;
    }

    /**
     * The refusal for a success status carrying a body this client cannot read.
     *
     * The first 120 characters go in the message because they identify the
     * sender at a glance: `<!doctype html>` says "you are talking to a web
     * server, not to this API" faster than any wording here could.
     *
     * One function for both the first attempt and the post-refresh retry — the
     * retry is a second copy of this whole response-reading path, and copies
     * are how one of them ends up fixed and the other not.
     */
    function unreadableResponse(status: number, text: string, contentType: string | null): RebaseApiError {
        const type = contentType?.split(";")[0].trim().toLowerCase() || "";
        // A body that says what it is — CSV, plain text, a PDF — was sent on
        // purpose, by a custom function or route; blaming the API URL for it
        // points the developer at a misconfiguration that does not exist.
        // Only HTML (or no type at all) is the signature of the wrong host.
        const deliberate = type !== "" && type !== "text/html" && !type.includes("json");
        const cause = deliberate
            ? `The body is ${type}. If this is a custom function that answers text or a file, ask for it ` +
              "with `functions.invoke(name, payload, { responseType: \"text\" | \"blob\" | \"response\" })`."
            : "This usually means the request reached something other than the Rebase API — a single-page-app " +
              "fallback serving index.html, or a proxy error page — so check the API URL configuration " +
              "(e.g. VITE_API_URL).";
        return new RebaseApiError(
            `The server answered ${status} with a body that is not JSON, so there is nothing to return. ` +
            `${cause} The body began: ${JSON.stringify(text.slice(0, 120))}`,
            { status, code: "INVALID_JSON_RESPONSE", ...(type ? { details: { contentType: type } } : {}) }
        );
    }

    /**
     * The server always emits the canonical
     * `{ error: { message, code, details?, requestId? } }` envelope (formatted
     * by the central `errorHandler`), so a field is read strictly from
     * `body.error.*` and never from the top level.
     */
    function getErrorField(obj: Record<string, unknown>, field: string): unknown {
        const err = obj?.error;
        if (err && typeof err === "object" && err !== null) {
            return (err as Record<string, unknown>)[field];
        }
        return undefined;
    }

    /**
     * `Retry-After` as whole seconds, or `undefined`.
     *
     * The header is either a number of seconds or an HTTP date; both spellings
     * are legal and servers use both, so both are read. A date in the past —
     * which happens on a clock skew — is clamped to 0 rather than negative.
     */
    function parseRetryAfter(header: string | null): number | undefined {
        if (!header) return undefined;
        const seconds = Number(header.trim());
        if (Number.isFinite(seconds)) return Math.max(0, Math.floor(seconds));
        const at = Date.parse(header);
        if (Number.isNaN(at)) return undefined;
        return Math.max(0, Math.round((at - Date.now()) / 1000));
    }

    /**
     * Everything a failed response says about itself, in one place.
     *
     * The request path reads a response twice — the first attempt and the
     * post-refresh retry — and the two used to build their error separately.
     * Which is how they came to disagree: both dropped `requestId` and
     * `Retry-After`, and a fix applied to one would have missed the other.
     */
    function errorFrom(
        res: { status: number; statusText: string; headers?: { get(name: string): string | null } },
        body: Record<string, unknown>,
        fallbackMessage: string
    ): RebaseApiError {
        const requestId = getErrorField(body, "requestId")
            ?? res.headers?.get("X-Request-ID")
            ?? undefined;
        return new RebaseApiError(
            String(getErrorField(body, "message") || fallbackMessage || `Request failed with status ${res.status}`),
            {
                status: res.status,
                code: (getErrorField(body, "code") as string | undefined) || defaultCodeForStatus(res.status),
                details: getErrorField(body, "details"),
                ...(typeof requestId === "string" && requestId ? { requestId } : {}),
                ...(() => {
                    const retryAfter = parseRetryAfter(res.headers?.get("Retry-After") ?? null);
                    return retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter };
                })()
            }
        );
    }

    /**
     * The token a request should carry: the getter's when one is installed,
     * otherwise the one held — or, when the token refresher says the held one
     * is spent, the one it hands back once its refresh lands.
     */
    async function tokenForRequest(): Promise<string | undefined> {
        if (tokenGetter) {
            try {
                const fetched = await tokenGetter();
                if (fetched !== null && fetched !== undefined) return fetched;
            } catch (e) {
                // Ignore error, fallback to static token if any
            }
            return token;
        }
        const pending = tokenRefresher?.();
        if (pending) {
            try {
                const fresh = await pending;
                if (fresh) return fresh;
            } catch (e) {
                // The refresher answers its own failures with a token; a
                // throw is a bug in it, and the held token is still the
                // best thing to send.
            }
        }
        return token;
    }

    /** The body as JSON, `{}` for none, `undefined` when it is there and is not JSON. */
    function parseBody(text: string): Record<string, unknown> | undefined {
        if (!text) return {};
        try {
            return parseRebaseJson<Record<string, unknown>>(text);
        } catch (e) {
            return undefined;
        }
    }

    /**
     * Send a request and hand back the response that answers it: the token
     * attached, a token refusal answered by one refresh and resend, and an
     * error status thrown as a {@link RebaseApiError}. The body of a success is
     * left unread, for the caller to read in whatever form it expects.
     *
     * One path for the first attempt and the post-refresh retry: the two used
     * to be separate copies of this whole sequence, and copies are how one of
     * them ends up fixed and the other not.
     */
    async function requestRaw(path: string, init?: RequestInit, meta?: ResponseMeta): Promise<Response> {
        const url = resolveBaseUrl(config.baseUrl) + apiPath + path;

        const activeToken = await tokenForRequest();

        warnIfAnonymousServerClient(activeToken);

        let res = await fetchFn(url, { ...init,
headers: getHeaders(activeToken, init) });
        // A body read to decide on a refresh is spent; it is kept here so the
        // error built from the same response can still quote it.
        let readText: string | undefined;

        if (res.status === 401 && onUnauthorizedHandler) {
            readText = await res.text().catch(() => "");
            if (isTokenRefusal(parseBody(readText) ?? {})) {
                const retried = await onUnauthorizedHandler();
                if (retried) {
                    let retryToken = token;
                    if (tokenGetter) {
                        try {
                            const fetched = await tokenGetter();
                            if (fetched !== null && fetched !== undefined) {
                                retryToken = fetched;
                            }
                        } catch (e) { /* ignore */ }
                    }
                    res = await fetchFn(url, { ...init,
headers: getHeaders(retryToken, init) });
                    readText = undefined;
                }
            }
        }

        // The response the caller gets is the one whose metadata describes
        // what they are holding — after a retry, recording the 401's would hand
        // back the ETag of an error page.
        if (meta) {
            meta.status = res.status;
            meta.etag = res.headers?.get?.("ETag") ?? undefined;
            meta.headers = res.headers;
        }

        if (!res.ok) {
            const text = readText ?? await res.text().catch(() => "");
            let fallbackMessage = res.statusText;
            if (res.status === 404 && !fallbackMessage) {
                const method = init?.method || "GET";
                fallbackMessage = `Endpoint not found (${method} ${path}). This usually means the collection is not registered on the backend, or the frontend API URL configuration (e.g. VITE_API_URL) is missing or pointing to the wrong host.`;
            }
            // On an error status an unreadable body does not matter — the
            // status is the answer and the message falls back to `statusText`.
            throw errorFrom(res, parseBody(text) ?? {}, fallbackMessage);
        }

        return res;
    }

    async function request<T = unknown>(path: string, init?: RequestInit, meta?: ResponseMeta): Promise<T> {
        const res = await requestRaw(path, init, meta);

        if (res.status === 204) return undefined as T; // SAFETY: HTTP 204 No Content has no body

        const text = await res.text().catch(() => "");
        /**
         * `undefined` when the body was there and could not be read as JSON.
         *
         * On a *success* status that is the whole answer, and `{}` was being
         * returned as though the server had sent it: `find()` answered `{}`
         * instead of an array, `getOne()` an empty object, with nothing thrown.
         *
         * The case that produces it is not exotic. Point `VITE_API_URL` at the
         * frontend's own host and `/api/data/posts` lands on the SPA fallback,
         * which answers `200` with `index.html` — so the misconfiguration the
         * 404 message spends four lines explaining reaches the caller, in its
         * most common form, as an empty success.
         */
        const body = parseBody(text);
        if (body === undefined) {
            throw unreadableResponse(res.status, text, res.headers?.get?.("Content-Type") ?? null);
        }

        return body as T;
    }

    return {
        request,
        requestRaw,
        setToken(newToken: string | null) { token = newToken || undefined; },
        setAuthTokenGetter(getter: () => Promise<string | null>) { tokenGetter = getter; },
        setOnUnauthorized(handler: () => Promise<boolean>) { onUnauthorizedHandler = handler; },
        setTokenRefresher(refresher: TokenRefresher | null) { tokenRefresher = refresher ?? undefined; },
        get baseUrl() { return resolveBaseUrl(config.baseUrl); },
        get apiPath() { return apiPath; },
        get storageUrlOrigin() { return config.storageUrlOrigin?.replace(/\/$/, "") || undefined; },
        get fetchFn() { return fetchFn; },
        getHeaders: (init?: RequestInit) => getHeaders(token, init),
        resolveToken: async () => (await tokenForRequest()) || null
    };
}
