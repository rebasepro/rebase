import { RealtimeProvider } from "@rebasepro/types";
import { logger } from "../utils/logger";

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
    /**
     * Whether this provider actually implements channels, presence and
     * broadcast. Declared by the provider rather than inferred, because the
     * alternative — assuming the default one does — is how these frames came to
     * be handed to an engine whose message switch drops them without a word.
     */
    supportsChannels?: boolean;
}

/**
 * Channel/presence/broadcast messages are engine-agnostic pub/sub — which is
 * why they go to a provider that implements them, not to whichever provider a
 * bootstrapper happened to mark `isDefault`.
 */
const CHANNEL_MESSAGE_TYPES = new Set([
    "join_channel", "leave_channel", "broadcast",
    "presence_track", "presence_untrack", "presence_state",
    // The catch-up request: same pub/sub surface, same routing. Omitting it
    // here once meant the set named "the channel messages" and was missing one.
    "channel_history"
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
 * - channel / presence / broadcast → the first provider that declares
 *   `supportsChannels` (these are global pub/sub, not bound to an engine — but
 *   they are not implemented by every engine either).
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

    /**
     * The provider channel frames go to, resolved once and reported once.
     *
     * By capability, not by default-ness: the default provider is whichever
     * bootstrapper set `isDefault`, and routing pub/sub there sends every
     * broadcast, presence update and catch-up request into an engine that may
     * not implement any of them. When the default *does* support channels it is
     * still preferred, so single-engine behaviour is unchanged.
     */
    let channelRouting: { provider?: WsRealtimeService; key?: string } | undefined;
    const forChannels = (): WsRealtimeService | undefined => {
        if (!channelRouting) {
            const entries = Object.entries(providers) as [string, RealtimeProvider][];
            const supports = ([, p]: [string, RealtimeProvider]) => asWs(p).supportsChannels === true;
            const chosen = entries.find(([key]) => key === defaultKey && supports([key, providers[key]]))
                ?? entries.find(supports);

            channelRouting = chosen ? { provider: asWs(chosen[1]), key: chosen[0] } : {};

            if (chosen) {
                logger.info(`📡 [Realtime] Channels, presence and broadcast are served by the "${chosen[0]}" data source.`);
            } else {
                logger.error(
                    "❌ [Realtime] No configured realtime provider implements channels, presence or broadcast — " +
                    `every channel frame will be refused. Configured sources: [${entries.map(([k]) => k).join(", ")}]. ` +
                    "Channels currently require a Postgres data source."
                );
            }
        }
        return channelRouting.provider;
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
            if (CHANNEL_MESSAGE_TYPES.has(type)) {
                const provider = forChannels();
                if (!provider) {
                    // Refusing is the point. Handing the frame to a provider
                    // that ignores it leaves the client waiting on a reply that
                    // will never come — `channel_history` buffers live messages
                    // for the full catch-up timeout on every join.
                    throw new Error(
                        `Channels are not supported by any configured data source — "${type}" refused.`
                    );
                }
                await provider.handleClientMessage(clientId, message, authContext);
                return;
            }
            // Anything else → default provider.
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
