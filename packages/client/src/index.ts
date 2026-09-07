import { createTransport, RebaseClientConfig } from "./transport";
import { RebaseClientError } from "./errors";
import { createAuth, CreateAuthOptions } from "./auth";
import { createAdmin, CreateAdminOptions } from "./admin";
import { createCron, CreateCronOptions } from "./cron";
import { createBackups } from "./backups";
import { createApiKeys, CreateApiKeysOptions } from "./api-keys";
import { CollectionClient, createCollectionClient } from "./collection";
import { createFunctionsClient } from "./functions";
import { createStorage } from "./storage";
import { ClientStorageSourceRegistry } from "./storage-registry";
import { RebaseWebSocketClient } from "./websocket";
import { RebaseRealtimeChannel, type ChannelOptions } from "./realtime-channel";
import { OfflineManager, type OfflineApi, type OfflineConfig } from "./offline";
import {
    DEFAULT_STORAGE_SOURCE_KEY,
    InsertOf,
    RebaseClient,
    RebaseSdkData,
    RowOf,
    StorageSource,
    StorageSourceDefinition,
    StorageSourceRegistry,
    UpdateOf
} from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

// ─── Public API surface ──────────────────────────────────────────────────────
//
// This barrel is the public API of `@rebasepro/client`. It is an explicit,
// curated list — NOT `export *` — so that adding an export to a module below
// does not silently republish it to app developers. Internal factories
// (`createTransport`, `createAuth`, `createCollectionClient`, …), the raw
// `Transport`, the storage-source registry impl, the JSON reviver, and the
// concrete `SDKQueryBuilder` class are intentionally NOT re-exported: they are
// implementation details of `createRebaseClient()` and have no external
// consumers. App developers reach them through the client instance, never by
// importing the factory. To add something to the public surface, add it here
// deliberately.

// Errors — the single error type thrown by SDK HTTP calls, plus the
// data-proxy's unknown-collection error.
export { RebaseApiError } from "./transport";
export { RebaseClientError } from "./errors";
// The codes `RebaseApiError.code` carries. An open union — routes add their own
// — so it gives completion on the common ones without pretending to be closed.
export type { RebaseErrorCode } from "@rebasepro/types";

// Query + collection types (annotate SDK results; construct via the fluent API).
export type { RebaseClientConfig, FindParams, FindResponse } from "./transport";
export type { CollectionClient } from "./collection";
export type { FindResult, SDKCollectionClient, SDKQueryBuilderInterface, PaginationMeta } from "@rebasepro/types";

// Pagination: `iterate()` / `findAll()` parameter types and the error a walk
// throws instead of quietly returning a truncated answer.
export type { IterateParams, FindAllParams, PageWalkOptions, CursorSpec } from "@rebasepro/types";
export { RebasePaginationError } from "@rebasepro/common";
export type { PaginationErrorCode } from "@rebasepro/common";

// Logical-condition helpers for `.where(or(...), and(...))`.
export { QueryBuilder, or, and, cond } from "@rebasepro/common";

// Auth: session/token types, config, and the pluggable storage strategies.
export { createCookieStorage, createMemoryStorage } from "./auth";
export type { AuthConfig, AuthStorage, CookieStorageOptions, CreateAuthOptions } from "./auth";
// `User` is re-exported alongside the session types because `client.auth` hands
// one back and a browser app installs `@rebasepro/client` only — `@rebasepro/types`
// is a transitive dependency there, not something a consumer can import from.
export type { User, RebaseSession, AuthTokens, AuthChangeEvent, DeviceSession } from "@rebasepro/types";

// Control-plane client option/DTO types (the client instance exposes the impls).
export type { CreateAdminOptions } from "./admin";
export type { AdminUser } from "./admin";
export type { CreateCronOptions } from "./cron";
export { createBackups } from "./backups";
export type { CreateBackupsOptions } from "./backups";
export type {
    ApiKeyMasked,
    ApiKeyPermission,
    ApiKeyWithSecret,
    CreateApiKeyRequest,
    CreateApiKeysOptions,
    UpdateApiKeyRequest
} from "./api-keys";
export type { FunctionInvokeOptions, FunctionsClient } from "./functions";

// Realtime: the WebSocket client class is internal to `createRebaseClient()`,
// but re-exported (see @internal on the class) so a data-source driver can
// construct it directly. Not a stable app-facing API.
export { RebaseWebSocketClient } from "./websocket";
export { RebaseRealtimeChannel } from "./realtime-channel";
export type {
    PresenceState,
    PresenceDiff,
    BroadcastEvent,
    ChannelTransport,
    ChannelOptions,
    ChannelHistoryEntry,
    ChannelHistoryResult
} from "./realtime-channel";

// Offline: config, the `client.offline` surface, and the metadata a UI needs
// to reflect sync state. `isOfflineError` distinguishes "there was no network
// and nothing local to answer with" from a request that genuinely failed.
// The store contract is public so other environments (React Native/
// AsyncStorage, Electron, …) can supply their own persistence;
// `MemoryOfflineStore` is exported for tests and as the reference
// implementation, while the IndexedDB store is wired automatically in the
// browser and needs no direct construction.
export type { OfflineApi, OfflineConfig, OfflineStatus } from "./offline";
export { isOfflineError } from "./offline";
export type { LiveResult, ObserveOptions, RowSnapshotMeta } from "./collection";
export type { OfflineStore, OfflineCacheEntry, OfflineCacheRecord, PendingMutation, MutationRollback } from "./offline-store";
export { MemoryOfflineStore } from "./offline-store";

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
    /**
     * Local-first sync for the data layer.
     *
     * `true` enables it with defaults: reads populate a local row database and
     * fall back to it (evaluating filters and sorts locally) when the network
     * is gone, writes made offline apply immediately and replay in order when
     * it returns, and `observe()` becomes a live query that emits from the
     * local database first. A rejected write is rolled back. Pass an
     * {@link OfflineConfig} to control the store, cache sizes, retry backoff,
     * or rejection handling.
     *
     * Local rows and queued writes are partitioned per signed-in user, and
     * shared across tabs. Off by default.
     */
    offline?: boolean | OfflineConfig;
}

// ─── Typed Data Proxy ────────────────────────────────────────────────────────
// Adds typed collection accessors when `DB` is provided via the SDK generator.

type KebabToCamelCase<S extends string> =
  S extends `${infer T}-${infer U}`
    ? `${T}${Capitalize<KebabToCamelCase<U>>}`
    : S;

// Resolve a generated `Database` entry from a (kebab-case) slug literal,
// or `unknown` when the slug isn't in the schema — the extractors below
// then fall back to the open row / partial shapes.
type DBEntry<DB, S extends string> =
    KebabToCamelCase<S> extends keyof DB ? DB[KebabToCamelCase<S>] : unknown;

type TypedDataLayer<DB> = {
    collection<S extends string>(slug: S): CollectionClient<
        RowOf<DBEntry<DB, S>>,
        InsertOf<DBEntry<DB, S>>,
        UpdateOf<DBEntry<DB, S>>
    >;
} & {
    [K in keyof DB]: CollectionClient<RowOf<DB[K]>, InsertOf<DB[K]>, UpdateOf<DB[K]>>;
} & RebaseSdkData;

/**
 * The return type of `createRebaseClient<DB>()`.
 *
 * This is `RebaseClient` (from `@rebasepro/types`) with all optional
 * capabilities populated and the `data` layer narrowed to provide
 * typed collection accessors when a `DB` schema generic is supplied.
 */
export type CreateRebaseClientResult<DB = Record<string, unknown>> = Omit<RebaseClient<DB>, "data" | "email"> & {
    setToken: (token: string | null) => void;
    setAuthTokenGetter: (getter: () => Promise<string | null>) => void;
    setOnUnauthorized: (handler: () => Promise<boolean>) => void;
    resolveToken: () => Promise<string | null>;
    auth: ReturnType<typeof createAuth>;
    admin: ReturnType<typeof createAdmin>;
    cron: ReturnType<typeof createCron>;
    backups: ReturnType<typeof createBackups>;
    apiKeys: ReturnType<typeof createApiKeys>;
    functions: ReturnType<typeof createFunctionsClient>;
    ws?: RebaseWebSocketClient;
    /**
     * Broadcast and presence channels.
     *
     * Was missing from this type while present on the returned object, which
     * made `client.realtime.channel(...)` a type error and forced every adopter
     * to cast around the feature before they could reach it.
     */
    realtime: {
        /**
         * Join a broadcast/presence channel. Repeated calls with the same name
         * return the same channel object. Throws only when the client was
         * created with `realtime: false`.
         *
         * Pass `{ history: true }` to have the channel replay what it missed on
         * join and on every reconnect, for channels the server retains.
         */
        channel: (name: string, options?: ChannelOptions) => RebaseRealtimeChannel;
    };
    /**
     * Release everything this client holds that can keep a process alive: the
     * realtime socket and its reconnect timer, channel presence heartbeats, the
     * offline manager, and the scheduled token refresh.
     *
     * Each of those keeps the Node event loop alive on its own, so a script
     * that does not call this will not exit — and, until the refresh timer was
     * included, one that *did* call it still would not if it had signed in.
     *
     * Safe when realtime was never started (`realtime: false`), safe when
     * signed out, and safe to call twice. It does not sign the user out: a
     * persisted session survives for the next client to restore.
     */
    close: () => void;
    storage: StorageSource;
    storageRegistry: StorageSourceRegistry;
    createStorageSource: (storageId: string) => StorageSource;
    fetchStorageSources: () => Promise<StorageSourceDefinition[]>;
    /**
     * POST to an arbitrary endpoint on this backend, returning its body
     * verbatim.
     *
     * The shorthand for {@link FunctionsClient.invoke} — `call("functions/x",
     * p)` is `functions.invoke("x", p)` — and it unwraps exactly as little.
     * Neither reaches into the response for a `data` key.
     */
    call: <T = unknown>(endpoint: string, payload?: unknown) => Promise<T>;
    collection: <M extends Record<string, unknown> = Record<string, unknown>>(slug: string) => CollectionClient<M>;
    data: TypedDataLayer<DB>;
    /** Present only when the client was created with `offline` enabled. */
    offline?: OfflineApi;
};

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Derive a WebSocket URL from an HTTP base URL.
 * `http://` → `ws://`, `https://` → `wss://`.
 *
 * A backend mounted under a path is the reason `baseUrl` accepts one, so the
 * path is kept. It used to be kept for an absolute `baseUrl` and dropped for a
 * relative one — resolved through `.origin` — so one deployment dialled two
 * different sockets depending on whether its config said `"/backend"` or
 * `"https://app.example.com/backend"`.
 *
 * Returns `""` when there is nothing to resolve against: a relative `baseUrl`
 * outside a browser has no origin, and inventing one would dial somewhere
 * arbitrary. The caller warns rather than leaving that silent.
 */
function deriveWebSocketUrl(baseUrl?: string): string {
    const toWsProtocol = (url: string): string => {
        const secure = /^(https|wss):/i.test(url);
        return url
            .replace(/^https?:\/\//i, secure ? "wss://" : "ws://")
            .replace(/^wss?:\/\//i, secure ? "wss://" : "ws://")
            .replace(/\/$/, "");
    };

    if (typeof window !== "undefined") {
        let absoluteUrl: string;
        if (!baseUrl) {
            absoluteUrl = window.location.origin;
        } else if (/^https?:\/\//i.test(baseUrl) || /^wss?:\/\//i.test(baseUrl)) {
            absoluteUrl = baseUrl;
        } else {
            try {
                const resolved = new URL(baseUrl, window.location.href);
                absoluteUrl = resolved.origin + resolved.pathname;
            } catch {
                absoluteUrl = window.location.origin;
            }
        }
        return toWsProtocol(absoluteUrl);
    }

    if (!baseUrl) return "";
    if (!/^https?:\/\//i.test(baseUrl) && !/^wss?:\/\//i.test(baseUrl)) {
        return "";
    }
    return toWsProtocol(baseUrl);
}

export function createRebaseClient<DB = Record<string, unknown>>(options: CreateRebaseClientOptions): CreateRebaseClientResult<DB> {
    // `credentialOutOfBand`: in cookie auth mode the credential is an httpOnly
    // cookie, so a tokenless transport is not an anonymous client and must not
    // trip the server-side anonymous guard (see `RebaseClientConfig.anonymous`).
    const transport = createTransport(options, { credentialOutOfBand: options.auth?.authFlowMode === "cookie" });
    const auth = createAuth(transport, options.auth);
    const admin = createAdmin(transport, options.admin);
    const cron = createCron(transport, options.cron);
    const backups = createBackups(transport);
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

    // Opting out has to happen before the URL is derived: `deriveWebSocketUrl`
    // always produces one, so a truthy check alone can never leave the socket
    // closed.
    const realtimeEnabled = options.realtime !== false;
    const resolvedWsUrl = realtimeEnabled
        ? (options.websocketUrl ?? deriveWebSocketUrl(options.baseUrl))
        : undefined;

    // Realtime is on unless it was switched off, so "on, but no URL could be
    // derived" is a misconfiguration and not a choice. It used to be silent:
    // the client simply had no socket, `observe()` quietly degraded to a
    // one-shot fetch, and `realtime.channel()` blamed `realtime: false` — an
    // option the caller had not passed.
    const realtimeUnreachable = realtimeEnabled && !resolvedWsUrl;
    const unreachableReason =
        "no WebSocket URL could be derived from baseUrl " +
        `${JSON.stringify(options.baseUrl ?? null)} — outside a browser there is no page origin ` +
        "to resolve a relative URL against. Pass an absolute `baseUrl`, set `websocketUrl` " +
        "explicitly, or pass `realtime: false` to say this was intended.";
    if (realtimeUnreachable) {
        console.warn(
            `[Rebase] Realtime is enabled but ${unreachableReason} ` +
            "Live queries will fall back to a single fetch and channels will throw."
        );
    }

    let ws: RebaseWebSocketClient | undefined;
    /** One channel object per name — see `realtime.channel`. */
    const realtimeChannels = new Map<string, RebaseRealtimeChannel>();
    if (resolvedWsUrl) {
        const wsOnUnauthorized = options.onUnauthorized || (() => auth.handleUnauthorized());

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
                // Not permanent: the client stays usable, and a later subscribe
                // should reconnect anonymously.
                ws.disconnect();
            } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
                // Only re-authenticate a socket that already exists. Signing in
                // is not a request for realtime, and dialling here would undo
                // lazy connect for every app with a login. A socket opened
                // later authenticates itself from `getAuthToken` on open.
                if (session?.accessToken && ws.hasSocket) {
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
        // `handleUnauthorized` (not a bare `refreshSession`) so that a refresh
        // the server rejects outright drops the session and emits SIGNED_OUT —
        // otherwise the app keeps thinking it is signed in and every view just
        // renders "Invalid or expired token".
        transport.setOnUnauthorized(() => auth.handleUnauthorized());
    }

    /**
     * Suggest the closest known collection key for a mistyped accessor.
     * Uses edit-distance-1 and prefix matching — no external dependency.
     */
    function suggestCollection(prop: string, knownKeys: string[]): string | undefined {
        // Prefix match (e.g. "prod" → "products")
        const prefixMatch = knownKeys.find(k => k.startsWith(prop) || prop.startsWith(k));
        if (prefixMatch) return prefixMatch;

        // Edit-distance-1: deletions, insertions, substitutions, transpositions
        for (const key of knownKeys) {
            if (Math.abs(key.length - prop.length) > 1) continue;
            let diffs = 0;
            const longer = key.length >= prop.length ? key : prop;
            const shorter = key.length >= prop.length ? prop : key;
            if (longer.length === shorter.length) {
                // Same length: allow 1 substitution or 1 transposition
                for (let i = 0; i < longer.length; i++) {
                    if (longer[i] !== shorter[i]) {
                        // Check for transposition
                        if (
                            i + 1 < longer.length &&
                            longer[i] === shorter[i + 1] &&
                            longer[i + 1] === shorter[i]
                        ) {
                            diffs++;
                            i++; // skip next char (already accounted for)
                            if (diffs > 1) break;
                            continue;
                        }
                        diffs++;
                    }
                    if (diffs > 1) break;
                }
            } else {
                // Length differs by 1: allow 1 insertion/deletion
                let li = 0;
                let si = 0;
                while (li < longer.length) {
                    if (si < shorter.length && longer[li] === shorter[si]) {
                        si++;
                    } else {
                        diffs++;
                    }
                    li++;
                    if (diffs > 1) break;
                }
            }
            if (diffs <= 1) return key;
        }

        return undefined;
    }

    // Offline layer: wraps every collection client with a read cache and a
    // write queue. Replay goes through *unwrapped* clients (the factory below)
    // so a failing replay can never re-queue itself.
    const offlineManager = options.offline
        ? new OfflineManager(
            typeof options.offline === "object" ? options.offline : {},
            (slug) => createCollectionClient(transport, slug)
        )
        : undefined;

    if (offlineManager) {
        // Cache and queue are partitioned per user: cached rows are RLS-scoped
        // to whoever fetched them, and queued writes must replay as the user
        // who made them — a shared browser must never mix the two.
        offlineManager.setScope(auth.getSession()?.user?.uid);
        auth.onAuthStateChange((event, session) => {
            offlineManager.setScope(event === "SIGNED_OUT" ? undefined : session?.user?.uid);
        });
    }

    const collectionClients = new Map<string, CollectionClient<Record<string, unknown>>>();
    let untypedWarned = false;

    function collection(slug: string): CollectionClient<Record<string, unknown>> {
        if (!collectionClients.has(slug)) {
            const inner = createCollectionClient(transport, slug, ws);
            collectionClients.set(slug, offlineManager ? offlineManager.wrap(slug, inner) : inner);
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
                if (options.collections) {
                    if (prop in options.collections) {
                        return collection(options.collections[prop]);
                    }
                    // Strict mode: the developer supplied a typed dictionary,
                    // so we know the full set of valid accessors.
                    const knownKeys = Object.keys(options.collections);
                    const suggestion = suggestCollection(prop, knownKeys);
                    const knownList = knownKeys.join(", ");
                    let msg = `Unknown collection accessor "${prop}". Known collections: ${knownList}.`;
                    if (suggestion) msg += ` Did you mean "${suggestion}"?`;
                    msg += ` Use data.collection("<slug>") for dynamic slugs.`;
                    throw new RebaseClientError(msg, {
                        code: "UNKNOWN_COLLECTION",
                        details: { accessor: prop, known: knownKeys }
                    });
                }
                // Untyped fallback: convert camelCase property names to snake_case slugs.
                // e.g. `companyMembers` → `company_members`
                if (!untypedWarned) {
                    untypedWarned = true;
                    console.warn(
                        `[Rebase] Untyped data access detected (client.data.${prop}). ` +
                        `Collection names are resolved via snake_case conversion, which may cause silent 404s at request time. ` +
                        `Pass a \`collections\` dictionary to createRebaseClient() or use the generated SDK for type-safe access.`
                    );
                }
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
        backups,
        apiKeys,
        functions,
        storage,
        storageRegistry,
        createStorageSource,
        fetchStorageSources,
        ws,
        realtime: {
            /**
             * Join a broadcast/presence channel.
             *
             * Repeated calls with the same name return the same channel, so
             * separate components can attach handlers without each opening its
             * own membership — and `leave()` from one would otherwise silently
             * cut off the others.
             */
            channel: (name: string, options?: ChannelOptions): RebaseRealtimeChannel => {
                // Being merely *unconnected* is not an error: the socket opens
                // on the first channel operation, which is the whole point of
                // asking for a channel before you use one. Having no socket at
                // all is, and there are two reasons for it — say which.
                if (!ws) {
                    throw new RebaseClientError(
                        realtimeUnreachable
                            ? `Realtime is enabled but ${unreachableReason}`
                            : "Realtime is disabled on this client (realtime: false), so channels are unavailable.",
                        { code: "REALTIME_DISABLED" }
                    );
                }
                let existing = realtimeChannels.get(name);
                if (!existing) {
                    existing = new RebaseRealtimeChannel(name, ws, options);
                    realtimeChannels.set(name, existing);
                } else if (options?.history) {
                    // Same object by name, so options on a later call have no
                    // new channel to apply to. Asking for history upgrades the
                    // one that exists rather than being quietly ignored — but
                    // never the reverse, so a caller that omits the option
                    // cannot switch it off under one that asked for it.
                    existing.enableHistory();
                }
                return existing;
            }
        },
        /**
         * Release every handle that can keep a process alive — see the
         * `close` docblock on the client interface.
         *
         * Safe to call when realtime was never started, safe when signed out,
         * and safe to call twice.
         */
        close: () => {
            // Channels hold presence heartbeat timers, which would otherwise
            // keep firing (and keep a Node process alive) after the socket
            // they publish over is gone.
            for (const channel of realtimeChannels.values()) void channel.leave();
            realtimeChannels.clear();
            // Permanent: nothing queued afterwards may redial and keep the
            // event loop alive, which is the reason this method exists.
            ws?.disconnect(true);
            // The offline retry timer is unref'd but the `online` listener is
            // not, and neither should outlive the client.
            offlineManager?.dispose();
            // The scheduled token refresh is a plain setTimeout up to a token
            // lifetime away, and not unref'd — so on Node it holds the event
            // loop open all by itself. Without this, closing a SIGNED-IN client
            // released the socket and the process still never exited, which is
            // the opposite of what this method exists to guarantee.
            auth.stopAutoRefresh();
        },
        setToken: transport.setToken,
        setAuthTokenGetter: transport.setAuthTokenGetter,
        setOnUnauthorized: transport.setOnUnauthorized,
        resolveToken: transport.resolveToken,
        baseUrl: transport.baseUrl,
        apiPath: transport.apiPath,
        collection,
        call: async <T = unknown>(endpoint: string, payload?: unknown): Promise<T> => {
            const prefix = endpoint.startsWith("/") ? "" : "/";
            // The body, verbatim — the same thing `functions.invoke()` returns.
            //
            // This used to end `return res.data ?? (res as T)`, unwrapping a
            // top-level `data` key when it saw one. The docs present `call()`
            // as a shorthand for `invoke()`, which does not, so the two
            // returned *different values* for the one function that happens to
            // answer `{ data: … }` — and silently, since the unwrap only fires
            // on the shape it fires on. A caller who wants `.data` can write
            // it; a caller whose function legitimately returns a `data` field
            // could not get it back at all.
            return transport.request<T>(`${prefix}${endpoint}`, {
                method: "POST",
                body: payload ? JSON.stringify(payload) : undefined
            });
        },
        data: dataProxy,
        ...(offlineManager ? { offline: offlineManager.api } : {}),
    } as unknown as CreateRebaseClientResult<DB>;

    return target;
}

