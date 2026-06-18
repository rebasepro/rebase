import type { Transport } from "./transport";

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
     * @typeParam T - Expected shape of the response payload.
     * @param name    - Function name (the filename without extension, e.g. `"extract-job"`).
     * @param payload - Optional JSON-serialisable body sent as `POST`.
     * @param options - Optional overrides (HTTP method, sub-path, extra headers).
     * @returns The parsed JSON response from the function.
     */
    invoke<T = unknown>(
        name: string,
        payload?: unknown,
        options?: FunctionInvokeOptions,
    ): Promise<T>;
}

export interface FunctionInvokeOptions {
    /** HTTP method — defaults to `"POST"`. */
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    /** Sub-path appended after the function name, e.g. `"status/123"`. */
    path?: string;
    /** Extra headers merged into the request (auth is still injected automatically). */
    headers?: Record<string, string>;
}

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
            const method = options?.method ?? "POST";
            const subPath = options?.path ? `/${options.path.replace(/^\//, "")}` : "";
            const routePath = `/functions/${encodeURIComponent(name)}${subPath}`;

            const init: RequestInit = { method };

            if (payload !== undefined && method !== "GET") {
                init.body = JSON.stringify(payload);
            }

            if (options?.headers) {
                init.headers = options.headers;
            }

            return transport.request<T>(routePath, init);
        }
    };
}
