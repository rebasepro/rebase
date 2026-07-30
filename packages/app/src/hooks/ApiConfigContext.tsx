import React, { useContext } from "react";

/**
 * Configuration for API connectivity. Passed once at the top level
 * and available to any hook that needs `apiUrl` or `getAuthToken`.
 *
 * Individual hooks can still accept explicit overrides — this context
 * serves as a fallback to eliminate repetitive threading.
 */
export interface ApiConfig {
    apiUrl: string;
    /**
     * The path the backend mounts its API under, appended to {@link apiUrl}.
     *
     * `"/api"` by default, which is the server's default `basePath`. It is
     * carried here because a good deal of UI builds request URLs by hand
     * instead of going through the client's typed methods, and every one of
     * those sites used to write `/api` as a literal — so a backend configured
     * with any other `basePath` served an admin panel whose auth-provider
     * discovery, storage browser, history panel, user picker and Studio tools
     * all requested paths that did not exist.
     */
    apiPath: string;
    getAuthToken?: () => Promise<string | null>;
}

/** What the server uses when `basePath` is not configured. */
export const DEFAULT_API_PATH = "/api";

const ApiConfigContext = React.createContext<ApiConfig | undefined>(undefined);

/**
 * Read the API config from context. Returns `undefined` if no provider is present,
 * allowing hooks to fall back to their own props.
 */
export function useApiConfig(): ApiConfig | undefined {
    return useContext(ApiConfigContext);
}

/**
 * `apiUrl` and `apiPath` joined, with no trailing slash — the prefix to build a
 * request URL from.
 *
 * Returns `undefined` when there is no provider, so a caller can keep its own
 * fallback rather than silently requesting a relative path.
 */
export function useApiBase(): string | undefined {
    const config = useApiConfig();
    if (!config?.apiUrl) return undefined;
    return config.apiUrl.replace(/\/+$/, "") + (config.apiPath || DEFAULT_API_PATH);
}

/**
 * The same prefix, derived from a client rather than from context.
 *
 * For the code that holds a `RebaseClient` but sits outside (or above) an
 * `ApiConfigProvider`. Returns `undefined` when the client has no base URL,
 * which is the signal every caller already treats as "cannot build a request".
 */
export function apiBaseOf(client?: { baseUrl?: string; apiPath?: string }): string | undefined {
    if (!client?.baseUrl) return undefined;
    return client.baseUrl.replace(/\/+$/, "") + (client.apiPath || DEFAULT_API_PATH);
}

/**
 * Provide API configuration (apiUrl, apiPath, getAuthToken) to the entire subtree.
 * Typically rendered inside `<Rebase>` or at the app root.
 */
export function ApiConfigProvider({
    apiUrl,
    apiPath = DEFAULT_API_PATH,
    getAuthToken,
    children
}: Omit<ApiConfig, "apiPath"> & { apiPath?: string; children: React.ReactNode }) {
    const value = React.useMemo(() => ({ apiUrl,
apiPath,
getAuthToken }), [apiUrl, apiPath, getAuthToken]);
    return (
        <ApiConfigContext.Provider value={value}>
            {children}
        </ApiConfigContext.Provider>
    );
}
