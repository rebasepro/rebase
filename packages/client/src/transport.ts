import { FindParams as TypesFindParams, FindResponse as TypesFindResponse, RebaseApiError, SCHEMA_VERSION_HEADER } from "@rebasepro/types";
import { serializeFilter, serializeLogicalCondition, serializeOrderBy } from "@rebasepro/common";
import { rebaseReviver } from "./reviver";

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
export type FindParams<M extends Record<string, unknown> = Record<string, unknown>> = TypesFindParams<M>;
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
function assertNoUndefinedFilterValues(where: Record<string, unknown>): void {
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

export function buildQueryString(params?: FindParams): string {
    if (!params) return "";
    const parts: string[] = [];

    if (params.limit != null) parts.push(`limit=${params.limit}`);
    if (params.offset != null) parts.push(`offset=${params.offset}`);
    if (params.page != null) parts.push(`page=${params.page}`);

    if (params.orderBy) {
        const wire = serializeOrderBy(params.orderBy);
        if (wire) parts.push(`orderBy=${encodeURIComponent(wire)}`);
    }

    if (params.searchString) {
        parts.push(`searchString=${encodeURIComponent(params.searchString)}`);
        if (params.searchExplain) parts.push("searchExplain=true");
    }

    // The server keys vector search off `vector_search` naming the property and
    // `vector` carrying the embedding as a JSON array; both must be present or
    // it ignores the pair entirely.
    if (params.vectorSearch) {
        const vs = params.vectorSearch;
        parts.push(`vector_search=${encodeURIComponent(vs.property)}`);
        parts.push(`vector=${encodeURIComponent(JSON.stringify(vs.vector))}`);
        if (vs.distance) parts.push(`vector_distance=${encodeURIComponent(vs.distance)}`);
        if (vs.threshold !== undefined) parts.push(`vector_threshold=${encodeURIComponent(String(vs.threshold))}`);
    }

    if (params.include && params.include.length > 0) {
        parts.push(`include=${encodeURIComponent(params.include.join(","))}`);
    }

    if (params.logical) {
        const root = params.logical;
        const serialized = (root.conditions ?? []).map(serializeLogicalCondition).join(",");
        parts.push(`${root.type}=${encodeURIComponent(`(${serialized})`)}`);
    }

    if (params.where) {
        assertNoUndefinedFilterValues(params.where);
        const serialized = serializeFilter(params.where);
        for (const [field, value] of Object.entries(serialized)) {
            if (Array.isArray(value)) {
                for (const v of value) {
                    parts.push(`${encodeURIComponent(field)}=${encodeURIComponent(v)}`);
                }
            } else {
                parts.push(`${encodeURIComponent(field)}=${encodeURIComponent(value)}`);
            }
        }
    }

    return parts.length > 0 ? "?" + parts.join("&") : "";
}

export interface Transport {
    request: <T = unknown>(path: string, init?: RequestInit) => Promise<T>;
    setToken: (newToken: string | null) => void;
    setAuthTokenGetter: (getter: () => Promise<string | null>) => void;
    setOnUnauthorized: (handler: () => Promise<boolean>) => void;
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
        ...(config.schemaVersion ? { [SCHEMA_VERSION_HEADER]: config.schemaVersion } : {})
    };

    function getHeaders(activeToken: string | undefined, init?: RequestInit) {
        return {
            "Content-Type": "application/json",
            ...defaultHeaders,
            ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
            ...((init?.headers as Record<string, string>) || {})
        };
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
    function unreadableResponse(status: number, text: string): RebaseApiError {
        return new RebaseApiError(
            `The server answered ${status} with a body that is not JSON, so there is nothing to return. ` +
            "This usually means the request reached something other than the Rebase API — a single-page-app " +
            "fallback serving index.html, or a proxy error page — so check the API URL configuration " +
            `(e.g. VITE_API_URL). The body began: ${JSON.stringify(text.slice(0, 120))}`,
            { status, code: "INVALID_JSON_RESPONSE" }
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
                code: getErrorField(body, "code") as string | undefined,
                details: getErrorField(body, "details"),
                ...(typeof requestId === "string" && requestId ? { requestId } : {}),
                ...(() => {
                    const retryAfter = parseRetryAfter(res.headers?.get("Retry-After") ?? null);
                    return retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter };
                })()
            }
        );
    }

    async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
        const url = resolveBaseUrl(config.baseUrl) + apiPath + path;

        let activeToken = token;
        if (tokenGetter) {
            try {
                const fetched = await tokenGetter();
                if (fetched !== null && fetched !== undefined) {
                    activeToken = fetched;
                }
            } catch (e) {
                // Ignore error, fallback to static token if any
            }
        }

        warnIfAnonymousServerClient(activeToken);

        const headers = getHeaders(activeToken, init);

        // If passing FormData, we MUST let fetch set the boundary, so remove Content-Type
        if (init?.body instanceof FormData) {
            delete (headers as Record<string, string>)["Content-Type"];
        }

        const res = await fetchFn(url, { ...init,
headers });

        if (res.status === 204) return undefined as T; // SAFETY: HTTP 204 No Content has no body

        const text = await res.text().catch(() => "");
        let body: Record<string, unknown> = {};
        /**
         * Whether the body was there and could not be read as JSON.
         *
         * On an error status this does not matter — the status is the answer
         * and the message falls back to `statusText`. On a *success* status it
         * is the whole answer, and `{}` was being returned as though the server
         * had sent it: `find()` answered `{}` instead of an array, `getOne()`
         * an empty object, with nothing thrown.
         *
         * The case that produces it is not exotic. Point `VITE_API_URL` at the
         * frontend's own host and `/api/data/posts` lands on the SPA fallback,
         * which answers `200` with `index.html` — so the misconfiguration the
         * 404 branch below spends four lines explaining reaches the caller, in
         * its most common form, as an empty success.
         */
        let unreadableBody = false;
        if (text) {
            try {
                body = JSON.parse(text, rebaseReviver) as Record<string, unknown>;
            } catch (e) {
                unreadableBody = true;
            }
        }

        if (res.status === 401 && onUnauthorizedHandler) {
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
                const retryHeaders = getHeaders(retryToken, init) as Record<string, string>;
                const retryRes = await fetchFn(url, { ...init,
headers: retryHeaders });
                if (retryRes.status === 204) return undefined as T; // SAFETY: HTTP 204 No Content has no body
                const retryText = await retryRes.text().catch(() => "");
                let retryBody: Record<string, unknown> = {};
                let retryUnreadable = false;
                if (retryText) {
                    try {
                        retryBody = JSON.parse(retryText, rebaseReviver);
                    } catch (e) {
                        retryUnreadable = true;
                    }
                }
                if (!retryRes.ok) {
                    let fallbackMessage = retryRes.statusText;
                    if (retryRes.status === 404 && !fallbackMessage) {
                        const method = init?.method || "GET";
                        fallbackMessage = `Endpoint not found (${method} ${path}). This usually means the collection is not registered on the backend, or the frontend API URL configuration (e.g. VITE_API_URL) is missing or pointing to the wrong host.`;
                    }
                    throw errorFrom(retryRes, retryBody, fallbackMessage);
                }
                if (retryUnreadable) throw unreadableResponse(retryRes.status, retryText);
                return retryBody as T;
            }
        }

        if (!res.ok) {
            let fallbackMessage = res.statusText;
            if (res.status === 404 && !fallbackMessage) {
                const method = init?.method || "GET";
                fallbackMessage = `Endpoint not found (${method} ${path}). This usually means the collection is not registered on the backend, or the frontend API URL configuration (e.g. VITE_API_URL) is missing or pointing to the wrong host.`;
            }
            throw errorFrom(res, body, fallbackMessage);
        }

        if (unreadableBody) throw unreadableResponse(res.status, text);

        return body as T;
    }

    return {
        request,
        setToken(newToken: string | null) { token = newToken || undefined; },
        setAuthTokenGetter(getter: () => Promise<string | null>) { tokenGetter = getter; },
        setOnUnauthorized(handler: () => Promise<boolean>) { onUnauthorizedHandler = handler; },
        get baseUrl() { return resolveBaseUrl(config.baseUrl); },
        get apiPath() { return apiPath; },
        get storageUrlOrigin() { return config.storageUrlOrigin?.replace(/\/$/, "") || undefined; },
        get fetchFn() { return fetchFn; },
        getHeaders: (init?: RequestInit) => getHeaders(token, init) as Record<string, string>,
        resolveToken: async () => {
            if (tokenGetter) {
                try {
                    const fetched = await tokenGetter();
                    if (fetched !== null && fetched !== undefined) {
                        return fetched;
                    }
                } catch (e) { /* ignore */ }
            }
            return token || null;
        }
    };
}
