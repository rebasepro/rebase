import { RealtimeProvider } from "@rebasepro/types";

/**
 * A realtime client message as forwarded by the WebSocket server.
 */
interface ClientMessage {
    type: string;
    payload?: Record<string, unknown>;
    subscriptionId?: string;
}

/**
 * The concrete realtime service surface the WebSocket server drives — the
 * typed {@link RealtimeProvider} plus the client-connection methods that
 * every engine's realtime service implements.
 */
export interface WsRealtimeService extends RealtimeProvider {
    addClient(clientId: string, ws: unknown): void;
    handleClientMessage(clientId: string, message: ClientMessage, authContext?: unknown): Promise<void> | void;
}

/** Channel/presence/broadcast messages are engine-agnostic pub/sub. */
const CHANNEL_MESSAGE_TYPES = new Set([
    "join_channel", "leave_channel", "broadcast",
    "presence_track", "presence_untrack", "presence_state"
]);

export interface RoutedRealtimeOptions {
    /** Per-engine realtime providers, keyed by data-source key. */
    providers: Record<string, RealtimeProvider>;
    /** Key of the default provider (handles channels/presence/broadcast). */
    defaultKey: string;
    /** Resolve a collection path to its data-source key. */
    resolveKey: (collectionPath: string) => string;
}

/**
 * Compose multiple per-engine {@link RealtimeProvider}s into one that routes
 * each subscription to the provider owning the subscribed collection — the
 * realtime counterpart of `buildRoutedRebaseData`.
 *
 * The WebSocket server stays single and engine-agnostic; this composite is
 * passed in its place. Routing rules:
 * - `subscribe_collection` / `subscribe_entity` → the provider for the
 *   collection's data source (by `payload.path`).
 * - `unsubscribe` → forwarded to all providers (a no-op on non-owners).
 * - channel / presence / broadcast → the default provider (these are global
 *   pub/sub, not bound to an engine).
 * - `addClient` and lifecycle (`onServerReady`/`destroy`/`stopListening`) →
 *   all providers (each registers its own ws close handler for cleanup).
 */
export function createRoutedRealtimeService(opts: RoutedRealtimeOptions): WsRealtimeService {
    const { providers, defaultKey, resolveKey } = opts;

    const asWs = (p: RealtimeProvider): WsRealtimeService => p as unknown as WsRealtimeService;
    const all = (): WsRealtimeService[] => Object.values(providers).map(asWs);
    const fallback = (): WsRealtimeService => asWs(providers[defaultKey] ?? Object.values(providers)[0]);
    const forPath = (path?: string): WsRealtimeService => {
        if (!path) return fallback();
        const key = resolveKey(path);
        return asWs(providers[key] ?? providers[defaultKey] ?? Object.values(providers)[0]);
    };

    return {
        addClient(clientId, ws) {
            for (const p of all()) p.addClient?.(clientId, ws);
        },

        async handleClientMessage(clientId, message, authContext) {
            const { type } = message;
            if (type === "subscribe_collection" || type === "subscribe_one") {
                await forPath(message.payload?.path as string | undefined)
                    .handleClientMessage(clientId, message, authContext);
                return;
            }
            if (type === "unsubscribe") {
                // The owning provider acts; others no-op on an unknown id.
                await Promise.all(all().map((p) => p.handleClientMessage(clientId, message, authContext)));
                return;
            }
            // Channels/presence/broadcast (and anything else) → default provider.
            await fallback().handleClientMessage(clientId, message, authContext);
        },

        subscribeToCollection(subscriptionId, config, callback) {
            forPath((config as { path?: string }).path).subscribeToCollection(subscriptionId, config, callback);
        },

        subscribeToOne(subscriptionId, config, callback) {
            forPath((config as { path?: string }).path).subscribeToOne(subscriptionId, config, callback);
        },

        unsubscribe(subscriptionId) {
            for (const p of all()) p.unsubscribe(subscriptionId);
        },

        async notifyUpdate(path: string, id: string, row: Record<string, unknown> | null, databaseId?: string) {
            await forPath(path).notifyUpdate(path, id, row, databaseId);
        },

        onServerReady(serverInfo) {
            for (const p of all()) p.onServerReady?.(serverInfo);
        },

        async destroy() {
            await Promise.all(all().map((p) => p.destroy?.()));
        },

        async stopListening() {
            await Promise.all(all().map((p) => p.stopListening?.()));
        }
    };
}
