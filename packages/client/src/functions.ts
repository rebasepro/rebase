import type { Transport } from "./transport";
import { RebaseClientError } from "@rebasepro/types";

/**
 * Client interface for invoking custom backend functions.
 *
 * Custom functions are Hono route files auto-mounted by the Rebase backend
 * at `/api/functions/{name}`.  The `FunctionsClient` wraps the shared
 * transport so callers never need to manually construct URLs or inject
 * auth tokens.
 *
 * @example
 * ```ts
 * const result = await client.functions.invoke<{ job: Job }>('extract-job', {
 *     url: 'https://example.com/posting',
 *     html: htmlContent,
 * });
 * ```
 */
export interface FunctionsClient {
    /**
     * Invoke a custom backend function by name.
     *
     * **The method is `POST` unless you say otherwise.** A function whose only
     * route is `app.get("/")` therefore answers 404 to a bare `invoke(name)` —
     * pass `{ method: "GET" }`, or write the route as `app.post`.
     *
     * @typeParam T - Expected shape of the response payload.
     * @param name    - Function name (the filename without extension, e.g. `"extract-job"`).
     *                  One path segment: a sub-path goes in `options.path`.
     * @param payload - Optional JSON-serialisable body. Dropped for `GET`.
     * @param options - Optional overrides (HTTP method, sub-path, extra headers).
     * @returns The parsed JSON response from the function.
     */
    invoke<T = unknown>(
        name: string,
        payload?: unknown,
        options?: FunctionInvokeOptions,
    ): Promise<T>;
}

export type { FunctionInvokeOptions } from "@rebasepro/types";
import type { FunctionInvokeOptions } from "@rebasepro/types";

/**
 * Create a `FunctionsClient` backed by the given transport.
 *
 * The transport already handles:
 * - Base URL resolution
 * - JWT injection via `Authorization: Bearer`
 * - 401 retry / `onUnauthorized` flow
 * - Consistent error throwing via `RebaseApiError`
 *
 * @internal
 */
export function createFunctionsClient(transport: Transport): FunctionsClient {
    return {
        async invoke<T = unknown>(
            name: string,
            payload?: unknown,
            options?: FunctionInvokeOptions
        ): Promise<T> {
            // A function name is ONE path segment — the loader takes functions
            // from the top level of the directory only and refuses
            // subdirectories — so `encodeURIComponent` below is right, and a
            // name carrying a `/` is always a mistake at the call site.
            //
            // Refused rather than encoded, because encoding it is silent and
            // wrong in the worst way: `invoke("storage-provision/<id>")` became
            // `POST /api/functions/storage-provision%2F<id>`, which matches no
            // route, so a route that exists answered a bare 404. That shipped,
            // and `rebase cloud storage create` read as an unimplemented feature
            // — including to the person who had implemented it. The sub-path
            // belongs in `options.path`.
            if (name.includes("/")) {
                throw new RebaseClientError(
                    `Invalid function name "${name}": a function name is a single path segment. ` +
                    "Pass anything after it as `options.path` — " +
                    `invoke("${name.split("/")[0]}", payload, { path: "${name.split("/").slice(1).join("/")}" }).`,
                    { code: "INVALID_FUNCTION_NAME", details: { name } }
                );
            }

            const method = options?.method ?? "POST";
            // A `path` that starts the query or fragment is appended as-is. Only a
            // real sub-path gets a separator: inserting one before `?days=30` asks
            // for `/functions/dashboard-stats/?days=30`, and the trailing slash
            // misses the route, so a function that exists answers 404 — and the
            // caller sees it as the backend being down rather than as a bad URL.
            const rawPath = options?.path;
            const subPath = rawPath
                ? (/^[?#]/.test(rawPath) ? rawPath : `/${rawPath.replace(/^\//, "")}`)
                : "";
            const routePath = `/functions/${encodeURIComponent(name)}${subPath}`;

            const init: RequestInit = { method };

            if (payload !== undefined && method !== "GET") {
                init.body = JSON.stringify(payload);
            }

            if (options?.headers) {
                init.headers = options.headers;
            }

            // The function's body, verbatim: nothing here reaches in for a
            // `data` key. `client.call()` used to, which made the documented
            // "shorthand for invoke" return a different value for any function
            // that answered `{ data: … }`.
            return transport.request<T>(routePath, init);
        }
    };
}
