import { createTransport, RebaseClientConfig } from "./transport";
import { createAuth, CreateAuthOptions } from "./auth";
import { createAdmin, CreateAdminOptions } from "./admin";
import { createCron, CreateCronOptions } from "./cron";
import { createApiKeys, CreateApiKeysOptions } from "./api-keys";
import { CollectionClient, createCollectionClient } from "./collection";
import { createFunctionsClient } from "./functions";
import { createStorage } from "./storage";
import { ClientStorageSourceRegistry } from "./storage-registry";
import { RebaseWebSocketClient } from "./websocket";
import {
    DEFAULT_STORAGE_SOURCE_KEY,
    RebaseClient,
    RebaseData,
    StorageSource,
    StorageSourceDefinition,
    StorageSourceRegistry
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

export * from "./transport";
export * from "./auth";
export * from "./admin";
export * from "./cron";
export * from "./api-keys";
export * from "./collection";
export * from "./query_builder";
export * from "./websocket";
export * from "./storage";
export * from "./storage-registry";
export * from "./reviver";
export * from "./functions";
export type { Entity, FindResponse } from "@rebasepro/types";

export interface CreateRebaseClientOptions extends RebaseClientConfig {
    auth?: CreateAuthOptions;
    admin?: CreateAdminOptions;
    cron?: CreateCronOptions;
    apiKeys?: CreateApiKeysOptions;
    /**
     * Declared storage sources for multi-backend support. Server-transport
     * entries are auto-wired into `client.storageRegistry`; `direct` sources
     * are registered app-side (e.g. via a Firebase Storage hook). The default
     * source (`storage`) is always registered under
     * {@link DEFAULT_STORAGE_SOURCE_KEY}.
     */
    storageSources?: StorageSourceDefinition[];
    /**
     * Maps camelCase property names / safe identifiers to the actual
     * collection slugs on the server (e.g. `{ companyMembers: "company-members" }`).
     * If provided, the data layer proxy will resolve property accessors to their
     * correct slugs via this map before falling back to automatic snake_casing.
     */
    collections?: Record<string, string>;
}

// ─── Typed Data Proxy ────────────────────────────────────────────────────────
// Adds typed collection accessors when `DB` is provided via the SDK generator.

type KebabToCamelCase<S extends string> =
  S extends `${infer T}-${infer U}`
    ? `${T}${Capitalize<KebabToCamelCase<U>>}`
    : S;

type TypedDataLayer<DB> = {
    collection<S extends string>(slug: S): CollectionClient<
        KebabToCamelCase<S> extends keyof DB
            ? (DB[KebabToCamelCase<S>] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>)
            : Record<string, unknown>
    >;
} & {
    [K in keyof DB]: CollectionClient<
        DB[K] extends { Row: infer R extends Record<string, unknown> } ? R : Record<string, unknown>
    >;
} & RebaseData;

/**
 * The return type of `createRebaseClient<DB>()`.
 *
 * This is `RebaseClient` (from `@rebasepro/types`) with all optional
 * capabilities populated and the `data` layer narrowed to provide
 * typed collection accessors when a `DB` schema generic is supplied.
 */
export type CreateRebaseClientResult<DB = Record<string, unknown>> = Omit<RebaseClient, "data"> & {
    setToken: (token: string | null) => void;
    setAuthTokenGetter: (getter: () => Promise<string | null>) => void;
    setOnUnauthorized: (handler: () => Promise<boolean>) => void;
    resolveToken: () => Promise<string | null>;
    auth: ReturnType<typeof createAuth>;
    admin: ReturnType<typeof createAdmin>;
    cron: ReturnType<typeof createCron>;
    apiKeys: ReturnType<typeof createApiKeys>;
    functions: ReturnType<typeof createFunctionsClient>;
    ws?: RebaseWebSocketClient;
    storage: StorageSource;
    storageRegistry: StorageSourceRegistry;
    createStorageSource: (storageId: string) => StorageSource;
    fetchStorageSources: () => Promise<StorageSourceDefinition[]>;
    call: <T = unknown>(endpoint: string, payload?: unknown) => Promise<T>;
    data: TypedDataLayer<DB>;
};

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Derive a WebSocket URL from an HTTP base URL.
 * `http://` → `ws://`, `https://` → `wss://`.
 */
function deriveWebSocketUrl(baseUrl?: string): string {
    if (typeof window !== "undefined") {
        let absoluteUrl = "";
        if (!baseUrl) {
            absoluteUrl = window.location.origin;
        } else if (/^https?:\/\//i.test(baseUrl) || /^wss?:\/\//i.test(baseUrl)) {
            absoluteUrl = baseUrl;
        } else {
            try {
                absoluteUrl = new URL(baseUrl, window.location.href).origin;
            } catch {
                absoluteUrl = window.location.origin;
            }
        }
        const protocol = absoluteUrl.startsWith("https:") || absoluteUrl.startsWith("wss:") ? "wss:" : "ws:";
        return absoluteUrl
            .replace(/^https?:\/\//i, `${protocol}//`)
            .replace(/^wss?:\/\//i, `${protocol}//`)
            .replace(/\/$/, "");
    }

    if (!baseUrl) return "";
    if (!/^https?:\/\//i.test(baseUrl) && !/^wss?:\/\//i.test(baseUrl)) {
        return "";
    }
    return baseUrl
        .replace(/^https?:\/\//i, (match) => match.toLowerCase() === "https://" ? "wss://" : "ws://")
        .replace(/\/$/, "");
}

export function createRebaseClient<DB = Record<string, unknown>>(options: CreateRebaseClientOptions): CreateRebaseClientResult<DB> {
    const transport = createTransport(options);
    const auth = createAuth(transport, options.auth);
    const admin = createAdmin(transport, options.admin);
    const cron = createCron(transport, options.cron);
    const apiKeys = createApiKeys(transport, options.apiKeys);
    const storage = createStorage(transport);
    const functions = createFunctionsClient(transport);

    // Build a server-backed StorageSource for a given storage-source key.
    const createStorageSource = (storageId: string): StorageSource =>
        storageId === DEFAULT_STORAGE_SOURCE_KEY ? storage : createStorage(transport, storageId);

    // Storage registry: always holds the default source, plus any declared
    // server-transport sources. `direct` sources are registered app-side.
    const storageRegistry = new ClientStorageSourceRegistry();
    storageRegistry.register(DEFAULT_STORAGE_SOURCE_KEY, storage);
    for (const def of options.storageSources ?? []) {
        if (def.transport === "server" && def.key !== DEFAULT_STORAGE_SOURCE_KEY) {
            storageRegistry.register(def.key, createStorageSource(def.key));
        }
    }

    // Discover storage sources from the backend, making the server the single
    // source of truth. Server-transport sources are auto-wired into the
    // registry; `direct` sources are returned for the app to register. The
    // promise is cached on success and reset on failure so it can be retried
    // (e.g. once the user authenticates).
    let storageSourcesPromise: Promise<StorageSourceDefinition[]> | undefined;
    const fetchStorageSources = (): Promise<StorageSourceDefinition[]> => {
        if (storageSourcesPromise) return storageSourcesPromise;
        storageSourcesPromise = transport
            .request<{ data: StorageSourceDefinition[] }>("/storage/sources")
            .then((res) => {
                const defs = res.data ?? [];
                for (const def of defs) {
                    if (def.transport === "server"
                        && def.key !== DEFAULT_STORAGE_SOURCE_KEY
                        && !storageRegistry.has(def.key)) {
                        storageRegistry.register(def.key, createStorageSource(def.key));
                    }
                }
                return defs;
            })
            .catch((e) => {
                storageSourcesPromise = undefined; // allow retry
                throw e;
            });
        return storageSourcesPromise;
    };

    const resolvedWsUrl = options.websocketUrl ?? deriveWebSocketUrl(options.baseUrl);

    let ws: RebaseWebSocketClient | undefined;
    if (resolvedWsUrl) {
        const wsOnUnauthorized = options.onUnauthorized || (async () => {
            try {
                await auth.refreshSession();
                return true;
            } catch (e) {
                return false;
            }
        });

        ws = new RebaseWebSocketClient({
            websocketUrl: resolvedWsUrl,
            getAuthToken: async () => {
                let session = auth.getSession();
                if (session && session.expiresAt <= Date.now() + 10000) {
                    try {
                        session = await auth.refreshSession();
                    } catch (e) { /* ignore */ }
                }
                return session?.accessToken || options.token || "";
            },
            onUnauthorized: wsOnUnauthorized
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
                if (options.collections && prop in options.collections) {
                    return collection(options.collections[prop]);
                }
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
        apiKeys,
        functions,
        storage,
        storageRegistry,
        createStorageSource,
        fetchStorageSources,
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
            return res.data ?? (res as T);
        },
        data: dataProxy,
        email: undefined
    } as unknown as CreateRebaseClientResult<DB>;

    return target;
}

