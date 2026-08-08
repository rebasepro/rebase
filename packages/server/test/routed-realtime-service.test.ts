import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { createRoutedRealtimeService } from "../src/services/routed-realtime-service";
import type { RealtimeProvider } from "@rebasepro/types";

function mockProvider(supportsChannels = false) {
    return {
        supportsChannels,
        addClient: jest.fn(),
        handleClientMessage: jest.fn(async () => {}),
        subscribeToCollection: jest.fn(),
        subscribeToOne: jest.fn(),
        unsubscribe: jest.fn(),
        notifyUpdate: jest.fn(async () => {}),
        onServerReady: jest.fn(),
        destroy: jest.fn(async () => {}),
        stopListening: jest.fn(async () => {})
    };
}

describe("createRoutedRealtimeService", () => {
    let pg: ReturnType<typeof mockProvider>;
    let mongo: ReturnType<typeof mockProvider>;
    let routed: ReturnType<typeof createRoutedRealtimeService>;

    beforeEach(() => {
        pg = mockProvider(true);
        mongo = mockProvider();
        routed = createRoutedRealtimeService({
            providers: { "(default)": pg as unknown as RealtimeProvider, mongo: mongo as unknown as RealtimeProvider },
            defaultKey: "(default)",
            resolveKey: (path) => (path.split("/")[0] === "events" ? "mongo" : "(default)")
        });
    });

    it("routes subscribe_collection to the provider owning the collection", async () => {
        await routed.handleClientMessage("c1", { type: "subscribe_collection", payload: { path: "events", subscriptionId: "s1" } });
        expect(mongo.handleClientMessage).toHaveBeenCalledTimes(1);
        expect(pg.handleClientMessage).not.toHaveBeenCalled();
    });

    it("routes subscribe_entity by path", async () => {
        await routed.handleClientMessage("c1", { type: "subscribe_one", payload: { path: "products", subscriptionId: "s2" } });
        expect(pg.handleClientMessage).toHaveBeenCalledTimes(1);
        expect(mongo.handleClientMessage).not.toHaveBeenCalled();
    });

    it("forwards unsubscribe to all providers (owner acts, others no-op)", async () => {
        await routed.handleClientMessage("c1", { type: "unsubscribe", subscriptionId: "s1" });
        expect(pg.handleClientMessage).toHaveBeenCalledTimes(1);
        expect(mongo.handleClientMessage).toHaveBeenCalledTimes(1);
    });

    it("sends channel/presence/broadcast to the provider that implements them", async () => {
        await routed.handleClientMessage("c1", { type: "broadcast", payload: { channel: "room", event: "x" } });
        await routed.handleClientMessage("c1", { type: "join_channel", payload: { channel: "room" } });
        await routed.handleClientMessage("c1", { type: "presence_track", payload: { channel: "room" } });
        // The catch-up request belongs to the same set. It was missing from it,
        // so it fell through to "anything else" and was routed by default-ness.
        await routed.handleClientMessage("c1", { type: "channel_history", payload: { channel: "room" } });
        expect(pg.handleClientMessage).toHaveBeenCalledTimes(4);
        expect(mongo.handleClientMessage).not.toHaveBeenCalled();
    });

    /**
     * Channel frames used to go to whichever provider a bootstrapper marked
     * `isDefault`. Only Postgres implements them, and Mongo's message switch has
     * no `default` arm — so on a Mongo-default project `broadcast()` resolved
     * and reached nobody, `onPresence` never fired, and every join spent the
     * full catch-up timeout waiting for a `channel_history` reply that was never
     * coming. Nothing was logged at any point.
     */
    it("routes channel frames by capability, not by which provider is default", async () => {
        const mongoDefault = createRoutedRealtimeService({
            providers: { mongo: mongo as unknown as RealtimeProvider, pg: pg as unknown as RealtimeProvider },
            defaultKey: "mongo",
            resolveKey: () => "mongo"
        });

        await mongoDefault.handleClientMessage("c1", { type: "broadcast", payload: { channel: "room", event: "x" } });

        expect(pg.handleClientMessage).toHaveBeenCalledTimes(1);
        expect(mongo.handleClientMessage).not.toHaveBeenCalled();
    });

    it("refuses channel frames loudly when no provider implements them", async () => {
        const noChannels = createRoutedRealtimeService({
            providers: { mongo: mongo as unknown as RealtimeProvider },
            defaultKey: "mongo",
            resolveKey: () => "mongo"
        });

        await expect(
            noChannels.handleClientMessage("c1", { type: "broadcast", payload: { channel: "room", event: "x" } })
        ).rejects.toThrow(/not supported/i);
        expect(mongo.handleClientMessage).not.toHaveBeenCalled();
    });

    it("still prefers the default provider when it does support channels", async () => {
        const bothSupport = createRoutedRealtimeService({
            providers: {
                second: mockProvider(true) as unknown as RealtimeProvider,
                "(default)": pg as unknown as RealtimeProvider
            },
            defaultKey: "(default)",
            resolveKey: () => "(default)"
        });

        await bothSupport.handleClientMessage("c1", { type: "join_channel", payload: { channel: "room" } });

        expect(pg.handleClientMessage).toHaveBeenCalledTimes(1);
    });

    it("addClient is forwarded to every provider", () => {
        const ws = {};
        routed.addClient("c1", ws);
        expect(pg.addClient).toHaveBeenCalledWith("c1", ws);
        expect(mongo.addClient).toHaveBeenCalledWith("c1", ws);
    });

    it("notifyUpdate routes by path", async () => {
        await routed.notifyUpdate("events", "e1", null);
        expect(mongo.notifyUpdate).toHaveBeenCalledTimes(1);
        expect(pg.notifyUpdate).not.toHaveBeenCalled();
    });

    it("unknown path falls back to the default provider", async () => {
        await routed.handleClientMessage("c1", { type: "subscribe_collection", payload: { path: "mystery", subscriptionId: "s9" } });
        expect(pg.handleClientMessage).toHaveBeenCalledTimes(1);
    });

    it("lifecycle methods fan out to all providers", async () => {
        routed.onServerReady?.({ port: 3000 });
        await routed.destroy?.();
        expect(pg.onServerReady).toHaveBeenCalledTimes(1);
        expect(mongo.onServerReady).toHaveBeenCalledTimes(1);
        expect(pg.destroy).toHaveBeenCalledTimes(1);
        expect(mongo.destroy).toHaveBeenCalledTimes(1);
    });
});
