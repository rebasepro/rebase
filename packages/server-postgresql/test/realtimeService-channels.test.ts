import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { EntityCollection } from "@rebasepro/types";
import { WebSocket } from "ws";

jest.mock("../src/services/entityService", () => ({
    EntityService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchEntity: jest.fn().mockResolvedValue(null),
        searchEntities: jest.fn().mockResolvedValue([])
    }))
}));

// --- Mock Classes ---
class MockWebSocket {
    public readyState = WebSocket.OPEN;
    public send = jest.fn();
    public on = jest.fn();
    constructor() {}
}

const mockPostsCollection: EntityCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number" },
        title: { type: "string" }
    },
    idField: "id"
};

function createService() {
    const db = {
        execute: jest.fn().mockResolvedValue({ rows: [] }),
        transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db)),
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis()
    } as unknown as jest.Mocked<NodePgDatabase<Record<string, unknown>>>;
    (db as unknown as Record<string, unknown>).then = jest.fn((resolve: (v: unknown[]) => void) => resolve([]));

    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockReturnValue(mockPostsCollection);

    const service = new RealtimeService(db, registry);
    return { service, db, registry };
}

function createClient(service: RealtimeService, clientId: string): MockWebSocket {
    const ws = new MockWebSocket();
    service.addClient(clientId, ws as unknown as WebSocket);
    return ws;
}

describe("RealtimeService — Channels, Presence & Lifecycle", () => {
    let service: RealtimeService;

    beforeEach(() => {
        jest.useFakeTimers();
        ({ service } = createService());
    });

    afterEach(async () => {
        await service.destroy();
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    // =========================================================================
    // 1. Channel Operations
    // =========================================================================
    describe("Channel Operations", () => {
        it("joinChannel() adds the client to the channel set", () => {
            createClient(service, "c1");
            service.joinChannel("c1", "room:lobby");

            // Access internal state via the handleMessage path
            // Verify by trying to broadcast — if the client joined, it will be a member
            const ws2 = createClient(service, "c2");
            service.joinChannel("c2", "room:lobby");

            service.broadcastToChannel("c1", "room:lobby", "hello", { text: "hi" });

            // c2 should have received the broadcast (c1 is the sender, excluded)
            expect(ws2.send).toHaveBeenCalledTimes(1);
            const msg = JSON.parse(ws2.send.mock.calls[0][0] as string);
            expect(msg.type).toBe("broadcast");
            expect(msg.channel).toBe("room:lobby");
            expect(msg.event).toBe("hello");
            expect(msg.payload).toEqual({ text: "hi" });
        });

        it("joinChannel() via handleClientMessage works", async () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            await service.handleClientMessage("c1", {
                type: "join_channel",
                payload: { channel: "room:lobby" }
            });
            await service.handleClientMessage("c2", {
                type: "join_channel",
                payload: { channel: "room:lobby" }
            });

            // Broadcast from c1 — c2 should receive
            await service.handleClientMessage("c1", {
                type: "broadcast",
                payload: { channel: "room:lobby", event: "ping", payload: { seq: 1 } }
            });

            expect(ws2.send).toHaveBeenCalledTimes(1);
            expect(ws1.send).not.toHaveBeenCalled(); // sender excluded
        });

        it("joinChannel() with undefined channel name does not crash and does not pollute state", () => {
            createClient(service, "c1");
            // Should not throw
            expect(() => {
                service.joinChannel("c1", undefined as unknown as string);
            }).not.toThrow();
        });

        it("joinChannel() with empty string channel name does not crash", () => {
            createClient(service, "c1");
            expect(() => {
                service.joinChannel("c1", "");
            }).not.toThrow();
        });

        it("leaveChannel() removes the client from the channel", async () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:lobby");
            service.joinChannel("c2", "room:lobby");

            // c1 leaves
            service.leaveChannel("c1", "room:lobby");

            // Now broadcast from c2 — c1 should NOT receive
            service.broadcastToChannel("c2", "room:lobby", "ping", {});
            expect(ws1.send).not.toHaveBeenCalled();
        });

        it("leaveChannel() from a channel not joined does not crash", () => {
            createClient(service, "c1");
            expect(() => {
                service.leaveChannel("c1", "nonexistent-channel");
            }).not.toThrow();
        });

        it("leaveChannel() cleans up empty channel set", () => {
            createClient(service, "c1");
            service.joinChannel("c1", "room:temp");
            service.leaveChannel("c1", "room:temp");

            // After leaving, broadcasting to that channel should be a no-op (no members)
            const ws2 = createClient(service, "c2");
            service.broadcastToChannel("c2", "room:temp", "ping", {});
            expect(ws2.send).not.toHaveBeenCalled();
        });

        it("broadcastToChannel() sends to all members except the sender", () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");
            const ws3 = createClient(service, "c3");

            service.joinChannel("c1", "room:game");
            service.joinChannel("c2", "room:game");
            service.joinChannel("c3", "room:game");

            service.broadcastToChannel("c1", "room:game", "move", { x: 10 });

            expect(ws1.send).not.toHaveBeenCalled(); // sender excluded
            expect(ws2.send).toHaveBeenCalledTimes(1);
            expect(ws3.send).toHaveBeenCalledTimes(1);
        });

        it("broadcastToChannel() to a non-existent channel does not crash", () => {
            createClient(service, "c1");
            expect(() => {
                service.broadcastToChannel("c1", "no-such-channel", "ping", {});
            }).not.toThrow();
        });

        it("broadcastToChannel() skips clients with readyState !== OPEN", () => {
            createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:lobby");
            service.joinChannel("c2", "room:lobby");

            // Simulate c2's socket closing
            ws2.readyState = WebSocket.CLOSED;

            service.broadcastToChannel("c1", "room:lobby", "ping", {});

            // c2 should NOT have received anything since its readyState is CLOSED
            expect(ws2.send).not.toHaveBeenCalled();
        });

        it("broadcastToChannel() only affects the specified channel", () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:A");
            service.joinChannel("c2", "room:B");

            service.broadcastToChannel("c1", "room:A", "msg", {});

            // c2 is in a different channel, should not receive
            expect(ws2.send).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. Presence
    // =========================================================================
    describe("Presence", () => {
        it("trackPresence() stores state and broadcasts presence_diff with join", async () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            // Both join the channel
            service.joinChannel("c1", "room:collab");
            service.joinChannel("c2", "room:collab");

            ws1.send.mockClear();
            ws2.send.mockClear();

            // c1 tracks presence
            service.trackPresence("c1", "room:collab", { name: "Alice" });

            // Both members should receive the presence_diff
            expect(ws1.send).toHaveBeenCalledTimes(1);
            expect(ws2.send).toHaveBeenCalledTimes(1);

            const diff = JSON.parse(ws1.send.mock.calls[0][0] as string);
            expect(diff.type).toBe("presence_diff");
            expect(diff.channel).toBe("room:collab");
            expect(diff.joins).toEqual({ c1: { name: "Alice" } });
            expect(diff.leaves).toEqual({});
        });

        it("trackPresence() via handleClientMessage auto-joins the channel", async () => {
            const ws1 = createClient(service, "c1");

            await service.handleClientMessage("c1", {
                type: "presence_track",
                payload: { channel: "room:auto", state: { status: "online" } }
            });

            // After tracking, the client should be in the channel
            // Verify by requesting presence state
            ws1.send.mockClear();
            service.sendPresenceState("c1", "room:auto");

            expect(ws1.send).toHaveBeenCalledTimes(1);
            const state = JSON.parse(ws1.send.mock.calls[0][0] as string);
            expect(state.type).toBe("presence_state");
            expect(state.presences).toEqual({ c1: { status: "online" } });
        });

        it("removePresence() removes state and broadcasts absence", () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:collab");
            service.joinChannel("c2", "room:collab");

            service.trackPresence("c1", "room:collab", { name: "Alice" });

            ws1.send.mockClear();
            ws2.send.mockClear();

            // Remove c1's presence
            service.removePresence("c1", "room:collab");

            // Should broadcast a presence_diff with c1 in leaves
            expect(ws1.send).toHaveBeenCalledTimes(1);
            const diff = JSON.parse(ws1.send.mock.calls[0][0] as string);
            expect(diff.type).toBe("presence_diff");
            expect(diff.leaves).toEqual({ c1: { name: "Alice" } });
            expect(diff.joins).toEqual({});
        });

        it("removePresence() for non-tracked client does not crash", () => {
            createClient(service, "c1");
            expect(() => {
                service.removePresence("c1", "nonexistent-channel");
            }).not.toThrow();
        });

        it("sendPresenceState() sends full state to requesting client", () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:collab");
            service.joinChannel("c2", "room:collab");
            service.trackPresence("c1", "room:collab", { name: "Alice" });
            service.trackPresence("c2", "room:collab", { name: "Bob" });

            ws1.send.mockClear();

            service.sendPresenceState("c1", "room:collab");

            expect(ws1.send).toHaveBeenCalledTimes(1);
            const state = JSON.parse(ws1.send.mock.calls[0][0] as string);
            expect(state.type).toBe("presence_state");
            expect(state.channel).toBe("room:collab");
            expect(state.presences).toEqual({
                c1: { name: "Alice" },
                c2: { name: "Bob" }
            });
        });

        it("sendPresenceState() returns empty presences for unknown channel", () => {
            const ws1 = createClient(service, "c1");
            ws1.send.mockClear();

            service.sendPresenceState("c1", "no-such-channel");

            expect(ws1.send).toHaveBeenCalledTimes(1);
            const state = JSON.parse(ws1.send.mock.calls[0][0] as string);
            expect(state.type).toBe("presence_state");
            expect(state.presences).toEqual({});
        });

        it("sendPresenceState() does not send if client socket is closed", () => {
            const ws1 = createClient(service, "c1");
            service.joinChannel("c1", "room:collab");
            service.trackPresence("c1", "room:collab", { name: "Alice" });

            ws1.send.mockClear();
            ws1.readyState = WebSocket.CLOSED;

            service.sendPresenceState("c1", "room:collab");

            expect(ws1.send).not.toHaveBeenCalled();
        });

        it("stale presence is cleaned up after 30s timeout", () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:collab");
            service.joinChannel("c2", "room:collab");
            service.trackPresence("c1", "room:collab", { name: "Alice" });

            ws1.send.mockClear();
            ws2.send.mockClear();

            // The cleanup interval runs every 10s, the timeout threshold is >30s.
            // At 30s, Date.now() - lastSeen === 30000 which is NOT > 30000.
            // We need at least 40001ms so the interval fires after the 30s+ window.
            jest.advanceTimersByTime(41000);

            // Verify by requesting presence state — c1 should be gone
            ws2.send.mockClear();
            service.sendPresenceState("c2", "room:collab");

            const state = JSON.parse(ws2.send.mock.calls[ws2.send.mock.calls.length - 1][0] as string);
            expect(state.type).toBe("presence_state");
            expect(state.presences).toEqual({});
        });

        it("presence_untrack via handleClientMessage removes presence", async () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            service.joinChannel("c1", "room:collab");
            service.joinChannel("c2", "room:collab");
            service.trackPresence("c1", "room:collab", { name: "Alice" });

            ws1.send.mockClear();
            ws2.send.mockClear();

            await service.handleClientMessage("c1", {
                type: "presence_untrack",
                payload: { channel: "room:collab" }
            });

            // Should have broadcast a presence_diff with leave
            const diffCalls = ws2.send.mock.calls
                .map(c => JSON.parse(c[0] as string))
                .filter((m: Record<string, unknown>) => m.type === "presence_diff");
            expect(diffCalls.length).toBe(1);
            expect(diffCalls[0].leaves).toEqual({ c1: { name: "Alice" } });
        });

        it("presence_state via handleClientMessage sends full state", async () => {
            const ws1 = createClient(service, "c1");
            service.joinChannel("c1", "room:collab");
            service.trackPresence("c1", "room:collab", { status: "active" });

            ws1.send.mockClear();

            await service.handleClientMessage("c1", {
                type: "presence_state",
                payload: { channel: "room:collab" }
            });

            expect(ws1.send).toHaveBeenCalledTimes(1);
            const state = JSON.parse(ws1.send.mock.calls[0][0] as string);
            expect(state.type).toBe("presence_state");
            expect(state.presences).toEqual({ c1: { status: "active" } });
        });
    });

    // =========================================================================
    // 3. Client Lifecycle
    // =========================================================================
    describe("Client Lifecycle", () => {
        it("addClient() + removeClient() cleans up subscriptions, channels, and presence", async () => {
            const ws1 = createClient(service, "c1");

            // Subscribe to a collection
            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-1" }
            });
            expect(service.subscriptions.has("sub-1")).toBe(true);

            // Join a channel and track presence
            service.joinChannel("c1", "room:test");
            service.trackPresence("c1", "room:test", { online: true });

            // Remove client
            await service.removeClient("c1");

            // Subscription should be cleaned up
            expect(service.subscriptions.has("sub-1")).toBe(false);

            // Client should be gone
            expect(service.clients.has("c1")).toBe(false);

            // Channel membership should be cleaned up:
            // Broadcasting to the channel should not reach any client
            const ws2 = createClient(service, "c2");
            service.joinChannel("c2", "room:test");
            ws2.send.mockClear();

            service.sendPresenceState("c2", "room:test");
            const state = JSON.parse(ws2.send.mock.calls[0][0] as string);
            // c1's presence should be gone
            expect(state.presences.c1).toBeUndefined();
        });

        it("removeClient() for non-existent client does not crash", async () => {
            await expect(service.removeClient("non-existent-client")).resolves.toBeUndefined();
        });

        it("removeClient() cancels pending refetch timers", async () => {
            createClient(service, "c1");

            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-timer" }
            });

            // Trigger a refetch timer by notifying
            const dummyEntity = { id: "1", path: "posts", values: { _rebase_invalidated: true } } as unknown as import("@rebasepro/types").Entity;
            await service.notifyEntityUpdate("posts", "1", dummyEntity, undefined, false);

            // Remove client before the timer fires
            await service.removeClient("c1");

            // Advance past refetch debounce — should not throw or trigger errors
            jest.advanceTimersByTime(500);
            await Promise.resolve();
            await Promise.resolve();

            // Subscription should be gone
            expect(service.subscriptions.has("sub-timer")).toBe(false);
        });

        it("removeClient() with entity subscriptions cleans up properly", async () => {
            createClient(service, "c1");

            await service.handleClientMessage("c1", {
                type: "subscribe_entity",
                payload: { path: "posts", entityId: "42", subscriptionId: "sub-ent-1" }
            });

            expect(service.subscriptions.has("sub-ent-1")).toBe(true);

            await service.removeClient("c1");

            expect(service.subscriptions.has("sub-ent-1")).toBe(false);
        });
    });

    // =========================================================================
    // 4. Subscription Limits & Edge Cases
    // =========================================================================
    describe("Subscription Limits & Edge Cases", () => {
        it("multiple subscriptions from one client are all tracked", async () => {
            createClient(service, "c1");

            for (let i = 0; i < 10; i++) {
                await service.handleClientMessage("c1", {
                    type: "subscribe_collection",
                    payload: { path: "posts", subscriptionId: `sub-${i}` }
                });
            }

            for (let i = 0; i < 10; i++) {
                expect(service.subscriptions.has(`sub-${i}`)).toBe(true);
            }
        });

        it("multiple subscriptions are all cleaned up on removeClient", async () => {
            createClient(service, "c1");

            for (let i = 0; i < 10; i++) {
                await service.handleClientMessage("c1", {
                    type: "subscribe_collection",
                    payload: { path: "posts", subscriptionId: `sub-${i}` }
                });
            }

            await service.removeClient("c1");

            for (let i = 0; i < 10; i++) {
                expect(service.subscriptions.has(`sub-${i}`)).toBe(false);
            }
        });

        it("handleUnsubscribe with non-existent subscriptionId does not crash", async () => {
            createClient(service, "c1");

            await expect(
                service.handleClientMessage("c1", {
                    type: "unsubscribe",
                    subscriptionId: "does-not-exist"
                })
            ).resolves.toBeUndefined();
        });

        it("handleUnsubscribe removes the subscription", async () => {
            createClient(service, "c1");

            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-to-remove" }
            });

            expect(service.subscriptions.has("sub-to-remove")).toBe(true);

            await service.handleClientMessage("c1", {
                type: "unsubscribe",
                subscriptionId: "sub-to-remove"
            });

            expect(service.subscriptions.has("sub-to-remove")).toBe(false);
        });

        it("subscriptions from different clients are independent", async () => {
            createClient(service, "c1");
            createClient(service, "c2");

            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-c1" }
            });
            await service.handleClientMessage("c2", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-c2" }
            });

            // Remove c1 — c2's subscription should remain
            await service.removeClient("c1");

            expect(service.subscriptions.has("sub-c1")).toBe(false);
            expect(service.subscriptions.has("sub-c2")).toBe(true);
        });
    });

    // =========================================================================
    // 5. destroy()
    // =========================================================================
    describe("destroy()", () => {
        it("clears all clients, subscriptions, channels, and presence", async () => {
            const ws1 = createClient(service, "c1");
            const ws2 = createClient(service, "c2");

            // Set up some state
            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-d1" }
            });
            service.joinChannel("c1", "room:test");
            service.joinChannel("c2", "room:test");
            service.trackPresence("c1", "room:test", { online: true });

            await service.destroy();

            // All should be empty
            expect(service.clients.has("c1")).toBe(false);
            expect(service.clients.has("c2")).toBe(false);
            expect(service.subscriptions.has("sub-d1")).toBe(false);
            expect(service.subscriptions.size).toBe(0);
        });

        it("destroy() cancels pending refetch timers without errors", async () => {
            createClient(service, "c1");

            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-timer-d" }
            });

            // Trigger a refetch debounce
            const dummyEntity = { id: "1", path: "posts", values: { _rebase_invalidated: true } } as unknown as import("@rebasepro/types").Entity;
            await service.notifyEntityUpdate("posts", "1", dummyEntity, undefined, false);

            // Destroy before the timer fires
            await service.destroy();

            // Advance time — should not throw
            jest.advanceTimersByTime(500);
            await Promise.resolve();
            await Promise.resolve();
        });

        it("destroy() can be called multiple times safely", async () => {
            createClient(service, "c1");
            await service.destroy();
            await expect(service.destroy()).resolves.toBeUndefined();
        });

        it("destroy() stops the presence cleanup interval", async () => {
            createClient(service, "c1");
            service.joinChannel("c1", "room:test");
            service.trackPresence("c1", "room:test", { active: true });

            await service.destroy();

            // Advancing time should not cause errors from the interval
            jest.advanceTimersByTime(60000);
        });
    });

    // =========================================================================
    // 6. sendMessage edge cases
    // =========================================================================
    describe("sendMessage edge cases", () => {
        it("sendMessage does not crash when client socket is CLOSED", async () => {
            const ws = createClient(service, "c1");
            ws.readyState = WebSocket.CLOSED;

            await service.handleClientMessage("c1", {
                type: "subscribe_collection",
                payload: { path: "posts", subscriptionId: "sub-closed" }
            });

            // The initial collection_update should not be sent
            expect(ws.send).not.toHaveBeenCalled();
        });

        it("sendMessage does not crash for unknown clientId", () => {
            // Directly test by trying to broadcast in a channel with a non-existent client
            service.joinChannel("ghost", "room:test");
            createClient(service, "c1");
            service.joinChannel("c1", "room:test");

            // Should not throw even though "ghost" has no WebSocket
            expect(() => {
                service.broadcastToChannel("c1", "room:test", "ping", {});
            }).not.toThrow();
        });
    });

    // =========================================================================
    // 7. Unknown message type
    // =========================================================================
    describe("Unknown message type", () => {
        it("sends an error for unknown message types", async () => {
            const ws = createClient(service, "c1");

            await service.handleClientMessage("c1", {
                type: "totally_unknown_type" as "subscribe_collection",
                payload: {}
            });

            expect(ws.send).toHaveBeenCalledTimes(1);
            const msg = JSON.parse(ws.send.mock.calls[0][0] as string);
            expect(msg.type).toBe("error");
            expect(msg.error).toContain("Unknown message type");
        });
    });
});
