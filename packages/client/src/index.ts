import { createTransport, RebaseClientConfig } from "./transport";
import { createAuth, CreateAuthOptions } from "./auth";
import { createAdmin, CreateAdminOptions } from "./admin";
import { createCron, CreateCronOptions } from "./cron";
import { createCollectionClient, CollectionClient } from "./collection";
import { createFunctionsClient } from "./functions";
import { createStorage } from "./storage";
import { RebaseWebSocketClient } from "./websocket";
import { RebaseClient, RebaseData, StorageSource } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

export * from "./transport";
export * from "./auth";
export * from "./admin";
export * from "./cron";
export * from "./collection";
export * from "./query_builder";
export * from "./websocket";
export * from "./storage";
export * from "./reviver";
export * from "./functions";
export type { Entity, FindResponse } from "@rebasepro/types";

export interface CreateRebaseClientOptions extends RebaseClientConfig {
    auth?: CreateAuthOptions;
    admin?: CreateAdminOptions;
    cron?: CreateCronOptions;
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
    functions: ReturnType<typeof createFunctionsClient>;
    ws?: RebaseWebSocketClient;
    storage: StorageSource;
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
    const storage = createStorage(transport);
    const functions = createFunctionsClient(transport);

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
            return res.data ?? (res as T);
        },
        data: dataProxy,
        email: undefined
    } as unknown as CreateRebaseClientResult<DB>;

    return target;
}

