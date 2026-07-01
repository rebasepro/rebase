import { FindParams as TypesFindParams, FindResponse as TypesFindResponse } from "@rebasepro/types";
import { serializeFilter, serializeLogicalCondition } from "@rebasepro/common";
import { rebaseReviver } from "./reviver";

export interface RebaseClientConfig {
    baseUrl?: string;
    token?: string;
    apiPath?: string;
    fetch?: typeof globalThis.fetch;
    onUnauthorized?: () => Promise<boolean>;
    websocketUrl?: string; // Optional real-time WebSocket connection
}

/**
 * Re-export from `@rebasepro/types` for backward compatibility.
 */
export type FindParams = TypesFindParams;
export type FindResponse<T> = TypesFindResponse<T extends Record<string, unknown> ? T : Record<string, unknown>>;

export class RebaseApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;

    constructor(status: number, message: string, code?: string, details?: unknown) {
        super(message);
        this.name = "RebaseApiError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function buildQueryString(params?: FindParams): string {
    if (!params) return "";
    const parts: string[] = [];

    if (params.limit != null) parts.push(`limit=${params.limit}`);
    if (params.offset != null) parts.push(`offset=${params.offset}`);
    if (params.page != null) parts.push(`page=${params.page}`);

    if (params.orderBy) {
        parts.push(`orderBy=${encodeURIComponent(params.orderBy)}`);
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
    readonly fetchFn: typeof globalThis.fetch;
    getHeaders: (init?: RequestInit) => Record<string, string>;
    resolveToken: () => Promise<string | null>;
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
        const base = config.baseUrl ? config.baseUrl.replace(/\/$/, "") : "";
        const url = base + apiPath + path;

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

        const getErrorField = (obj: Record<string, unknown>, field: string): unknown => {
            const err = obj?.error;
            if (err && typeof err === "object" && err !== null && field in (err as Record<string, unknown>)) {
                return (err as Record<string, unknown>)[field];
            }
            return obj?.[field];
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
                        retryRes.status,
                        String(getErrorField(retryBody, "message") || fallbackMessage || `Request failed with status ${retryRes.status}`),
                        getErrorField(retryBody, "code") as string | undefined,
                        getErrorField(retryBody, "details")
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
                res.status,
                String(getErrorField(body, "message") || fallbackMessage || `Request failed with status ${res.status}`),
                getErrorField(body, "code") as string | undefined,
                getErrorField(body, "details")
            );
        }

        return body as T;
    }

    return {
        request,
        setToken(newToken: string | null) { token = newToken || undefined; },
        setAuthTokenGetter(getter: () => Promise<string | null>) { tokenGetter = getter; },
        setOnUnauthorized(handler: () => Promise<boolean>) { onUnauthorizedHandler = handler; },
        get baseUrl() { return config.baseUrl ? config.baseUrl.replace(/\/$/, "") : ""; },
        get apiPath() { return apiPath; },
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
