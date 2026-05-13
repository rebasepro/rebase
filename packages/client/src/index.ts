import { createTransport, RebaseClientConfig } from "./transport";
import { createAuth, CreateAuthOptions } from "./auth";
import { createAdmin, CreateAdminOptions } from "./admin";
import { createCron, CreateCronOptions } from "./cron";
import { createCollectionClient, CollectionClient } from "./collection";
import { createFunctionsClient } from "./functions";
import type { FunctionsClient } from "./functions";

export * from "./transport";
export * from "./auth";
export * from "./admin";
export * from "./cron";
export * from "./collection";
export * from "./websocket";
export * from "./storage";
export * from "./reviver";
export * from "./functions";

export interface CreateRebaseClientOptions extends RebaseClientConfig {
    auth?: CreateAuthOptions;
    admin?: CreateAdminOptions;
    cron?: CreateCronOptions;
}

import { RebaseWebSocketClient } from "./websocket";
import { RebaseClient as BaseRebaseClient, RebaseData, CollectionAccessor, StorageSource } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

export type RebaseClient<DB = Record<string, unknown>> = BaseRebaseClient<DB> & {
    setToken: (token: string | null) => void;
    setAuthTokenGetter: (getter: () => Promise<string | null>) => void;
    setOnUnauthorized: (handler: () => Promise<boolean>) => void;
    resolveToken: () => Promise<string | null>;
    auth: ReturnType<typeof createAuth>;
    admin: ReturnType<typeof createAdmin>;
    cron: ReturnType<typeof createCron>;
    functions: FunctionsClient;
    ws?: RebaseWebSocketClient;
    storage?: StorageSource;
    call: <T = unknown>(endpoint: string, payload?: unknown) => Promise<T>;
    data: RebaseData & {
        collection<K extends keyof DB>(slug: Extract<K, string>): CollectionClient<
            DB[K] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>
        >;
    } & {
        [K in keyof DB]: CollectionClient<
            DB[K] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>
        >;
    };
};

import { createStorage } from "./storage";

/**
 * Derive a WebSocket URL from an HTTP base URL.
 * `http://` → `ws://`, `https://` → `wss://`.
 */
function deriveWebSocketUrl(baseUrl?: string): string {
    if (!baseUrl) {
        // If no baseUrl is provided, we can try to derive it from the window object if in browser
        if (typeof window !== "undefined") {
            const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
            return `${protocol}//${window.location.host}`;
        }
        return "";
    }
    return baseUrl
        .replace(/^https:\/\//, "wss://")
        .replace(/^http:\/\//, "ws://")
        .replace(/\/$/, "");
}

export function createRebaseClient<DB = Record<string, unknown>>(options: CreateRebaseClientOptions): RebaseClient<DB> {
    const transport = createTransport(options);
    const auth = createAuth(transport, options.auth);
    const admin = createAdmin(transport, options.admin);
    const cron = createCron(transport, options.cron);
    const storage = createStorage(transport);
    const functions = createFunctionsClient(transport);

    const resolvedWsUrl = options.websocketUrl ?? deriveWebSocketUrl(options.baseUrl);

    let ws: RebaseWebSocketClient | undefined;
    if (resolvedWsUrl) {
        ws = new RebaseWebSocketClient({
            websocketUrl: resolvedWsUrl,
            getAuthToken: async () => {
                const session = await auth.getSession();
                return session?.accessToken || options.token || "";
            }
        });

        auth.onAuthStateChange((event, session) => {
            if (!ws) return;
            if (event === "SIGNED_OUT") {
                ws.disconnect();
            } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
                if (session?.accessToken) {
                    ws.authenticate(session.accessToken).catch(console.warn);
                }
            }
        });
    }

    // Register transport callback for 401s after auth is instantiated.
    // IMPORTANT: We must use transport.setOnUnauthorized() here — NOT set
    // options.onUnauthorized — because the transport was already created above
    // and captured the (undefined) value from the config closure.
    if (!options.onUnauthorized) {
        transport.setOnUnauthorized(async () => {
            try {
                await auth.refreshSession();
                return true;
            } catch (e) {
                return false;
            }
        });
    }

    const collectionClients = new Map<string, CollectionClient<Record<string, unknown>>>();

    function collection(slug: string): CollectionClient<Record<string, unknown>> {
        if (!collectionClients.has(slug)) {
            collectionClients.set(slug, createCollectionClient(transport, slug, ws));
        }
        return collectionClients.get(slug)!;
    }

    const dataTarget = { collection } as Record<string, unknown>;

    const dataProxy = new Proxy(dataTarget, {
        get(_target, prop: string | symbol) {
            if (prop === "collection") {
                return collection;
            }
            if (typeof prop === "symbol") return undefined;
            if (typeof prop === "string" && prop !== "then" && prop !== "toJSON" && prop !== "$$typeof") {
                // Convert camelCase property names to snake_case slugs.
                // e.g. `companyMembers` → `company_members`
                const slug = toSnakeCase(prop);
                return collection(slug);
            }
            return undefined;
        }
    });

    const target = {
        auth,
        admin,
        cron,
        functions,
        storage,
        ws,
        setToken: transport.setToken,
        setAuthTokenGetter: transport.setAuthTokenGetter,
        setOnUnauthorized: transport.setOnUnauthorized,
        resolveToken: transport.resolveToken,
        baseUrl: transport.baseUrl,
        collection,
        call: async <T = unknown>(endpoint: string, payload?: unknown): Promise<T> => {
            const prefix = endpoint.startsWith("/") ? "" : "/";
            const res = await transport.request<{ data: T }>(`${prefix}${endpoint}`, {
                method: "POST",
                body: payload ? JSON.stringify(payload) : undefined
            });
            return res.data ?? (res as unknown as T);
        },
        data: dataProxy,
        email: undefined
    } as unknown as RebaseClient<DB>;

    return target;
}
