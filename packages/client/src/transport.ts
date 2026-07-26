import { FindParams as TypesFindParams, FindResponse as TypesFindResponse, RebaseApiError } from "@rebasepro/types";
import { serializeFilter, serializeLogicalCondition, serializeOrderBy } from "@rebasepro/common";
import { rebaseReviver } from "./reviver";

// The canonical client error now lives in `@rebasepro/types` so every package
// (client, auth, …) throws one type. Re-exported here to preserve the historical
// `import { RebaseApiError } from ".../transport"` path used across the SDK.
export { RebaseApiError } from "@rebasepro/types";
export type { RebaseErrorInit } from "@rebasepro/types";

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
}

/**
 * Re-export from `@rebasepro/types` for backward compatibility.
 *
 * Forwards the row type: without the parameter this alias flattened
 * `FindParams<M>` back to its `Record<string, unknown>` default, and `where` /
 * `orderBy` went back to accepting any column name — the alias, not the
 * definition, was where the typing was lost.
 */
export type FindParams<M extends Record<string, unknown> = Record<string, unknown>> = TypesFindParams<M>;
export type FindResponse<T> = TypesFindResponse<T extends Record<string, unknown> ? T : Record<string, unknown>>;

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

export function createTransport(config: RebaseClientConfig): Transport {
    const fetchFn = config.fetch || globalThis.fetch;
    const apiPath = config.apiPath || "/api";
    let token = config.token;
    let tokenGetter: (() => Promise<string | null>) | undefined;
    let onUnauthorizedHandler = config.onUnauthorized;

    function getHeaders(activeToken: string | undefined, init?: RequestInit) {
        return {
            "Content-Type": "application/json",
            ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
            ...((init?.headers as Record<string, string>) || {})
        };
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
        if (text) {
            try {
                body = JSON.parse(text, rebaseReviver) as Record<string, unknown>;
            } catch (e) {
                // If not valid JSON, fallback
            }
        }

        // The server always emits the canonical `{ error: { message, code, details? } }`
        // envelope (formatted by the central errorHandler), so we read strictly
        // from `body.error.*`.
        const getErrorField = (obj: Record<string, unknown>, field: string): unknown => {
            const err = obj?.error;
            if (err && typeof err === "object" && err !== null) {
                return (err as Record<string, unknown>)[field];
            }
            return undefined;
        };

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
                if (retryText) {
                    try {
                        retryBody = JSON.parse(retryText, rebaseReviver);
                    } catch (e) { /* ignore */ }
                }
                if (!retryRes.ok) {
                    let fallbackMessage = retryRes.statusText;
                    if (retryRes.status === 404 && !fallbackMessage) {
                        const method = init?.method || "GET";
                        fallbackMessage = `Endpoint not found (${method} ${path}). This usually means the collection is not registered on the backend, or the frontend API URL configuration (e.g. VITE_API_URL) is missing or pointing to the wrong host.`;
                    }
                    throw new RebaseApiError(
                        String(getErrorField(retryBody, "message") || fallbackMessage || `Request failed with status ${retryRes.status}`),
                        {
                            status: retryRes.status,
                            code: getErrorField(retryBody, "code") as string | undefined,
                            details: getErrorField(retryBody, "details")
                        }
                    );
                }
                return retryBody as T;
            }
        }

        if (!res.ok) {
            let fallbackMessage = res.statusText;
            if (res.status === 404 && !fallbackMessage) {
                const method = init?.method || "GET";
                fallbackMessage = `Endpoint not found (${method} ${path}). This usually means the collection is not registered on the backend, or the frontend API URL configuration (e.g. VITE_API_URL) is missing or pointing to the wrong host.`;
            }
            throw new RebaseApiError(
                String(getErrorField(body, "message") || fallbackMessage || `Request failed with status ${res.status}`),
                {
                    status: res.status,
                    code: getErrorField(body, "code") as string | undefined,
                    details: getErrorField(body, "details")
                }
            );
        }

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
