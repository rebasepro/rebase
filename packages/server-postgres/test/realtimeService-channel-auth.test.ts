/**
 * The channel gate.
 *
 * Two internal tables — `rebase.channel_presence` and `rebase.channel_messages` —
 * are held outside the RLS model on the stated grounds that "the server evaluates
 * channel rules before it reads". No such evaluation existed: `channel_history`
 * and `presence_state` answered any socket about any channel, and `broadcast`
 * fanned out to a channel's members on behalf of a sender who had never joined
 * it. These pin the floor that now backs that claim — membership — and the
 * authorizer seam layered on top of it.
 *
 * Every case drives `handleClientMessage`, because that is the trust boundary.
 * The public methods below it are primitives the server calls on its own behalf.
 */
import { RealtimeService } from "../src/services/realtimeService";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { CollectionConfig } from "@rebasepro/types";
import { WebSocket } from "ws";

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(null),
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

class MockWebSocket {
    public readyState = WebSocket.OPEN;
    public send = jest.fn();
    public on = jest.fn();
}

const mockPostsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "number" } },
    idField: "id"
};

function createService() {
    const db = {
        execute: jest.fn().mockResolvedValue({ rows: [] }),
        transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(db))
    } as unknown as jest.Mocked<NodePgDatabase<Record<string, unknown>>>;

    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockReturnValue(mockPostsCollection);

    return new RealtimeService(db, registry);
}

function createClient(service: RealtimeService, clientId: string): MockWebSocket {
    const ws = new MockWebSocket();
    service.addClient(clientId, ws as unknown as WebSocket);
    return ws;
}

/** Every frame the socket received, parsed. */
const frames = (ws: MockWebSocket) =>
    ws.send.mock.calls.map((call) => JSON.parse(call[0] as string) as Record<string, any>);

const framesOfType = (ws: MockWebSocket, type: string) =>
    frames(ws).filter((frame) => frame.type === type);

describe("RealtimeService — the channel gate", () => {
    let service: RealtimeService;

    beforeEach(() => {
        service = createService();
    });

    afterEach(async () => {
        await service.destroy();
        jest.clearAllMocks();
    });

    describe("membership is required", () => {
        it("refuses presence_state for a channel the client never joined", async () => {
            const member = createClient(service, "member");
            const stranger = createClient(service, "stranger");

            await service.handleClientMessage("member", {
                type: "presence_track",
                payload: { channel: "doc:42", state: { name: "Alice", email: "alice@example.com" } }
            });

            stranger.send.mockClear();
            await service.handleClientMessage("stranger", {
                type: "presence_state",
                payload: { channel: "doc:42" }
            });

            // The roster carries user identity in the documented usage, so
            // answering at all is the leak — an empty answer would be one too,
            // since it still confirms the channel.
            expect(framesOfType(stranger, "presence_state")).toHaveLength(0);
            expect(framesOfType(stranger, "error")[0]?.payload?.error?.code).toBe("CHANNEL_FORBIDDEN");
            expect(member.send).toBeDefined();
        });

        /**
         * The client has nowhere to put an error that names no channel: channel
         * frames are fire-and-forget, so there is no pending request to reject
         * and no subscription id to match, and a refusal fell through into a
         * console warning. It already routes channel-addressed frames by name,
         * so naming the channel is what makes `channel.onError()` possible.
         */
        it("names the channel on the refusal, so the client can deliver it", async () => {
            const stranger = createClient(service, "stranger");

            await service.handleClientMessage("stranger", {
                type: "broadcast",
                payload: { channel: "doc:42", event: "op", payload: { forged: true } }
            });

            const frame = framesOfType(stranger, "error")[0];
            expect(frame?.payload?.error?.code).toBe("CHANNEL_FORBIDDEN");
            expect(frame?.channel).toBe("doc:42");
            expect(frame?.payload?.channel).toBe("doc:42");
        });

        it("refuses channel_history for a channel the client never joined", async () => {
            await service.configureChannelHistory([{ match: "doc:*", limit: 500 }]);
            const stranger = createClient(service, "stranger");

            await service.handleClientMessage("stranger", {
                type: "channel_history",
                payload: { channel: "doc:42", sinceSeq: 0, limit: 1000 }
            });

            expect(framesOfType(stranger, "channel_history")).toHaveLength(0);
            expect(framesOfType(stranger, "error")[0]?.payload?.error?.code).toBe("CHANNEL_FORBIDDEN");
        });

        it("refuses a broadcast from a sender that never joined the channel", async () => {
            const member = createClient(service, "member");
            const stranger = createClient(service, "stranger");

            await service.handleClientMessage("member", {
                type: "join_channel",
                payload: { channel: "doc:42" }
            });
            member.send.mockClear();

            await service.handleClientMessage("stranger", {
                type: "broadcast",
                payload: { channel: "doc:42", event: "op", payload: { forged: true } }
            });

            // A forged operation injected into everyone else's live stream is
            // the sharp end of this one.
            expect(member.send).not.toHaveBeenCalled();
            expect(framesOfType(stranger, "error")[0]?.payload?.error?.code).toBe("CHANNEL_FORBIDDEN");
        });

        it("serves the same three frames once the client has joined", async () => {
            // No retention rule here, so `channel_history` answers
            // `retained: false` and `broadcast` takes the ephemeral path — this
            // is about the gate, not about what is behind it.
            const member = createClient(service, "member");
            const other = createClient(service, "other");

            await service.handleClientMessage("other", { type: "join_channel", payload: { channel: "doc:42" } });
            await service.handleClientMessage("member", { type: "join_channel", payload: { channel: "doc:42" } });
            other.send.mockClear();

            await service.handleClientMessage("member", { type: "presence_state", payload: { channel: "doc:42" } });
            await service.handleClientMessage("member", { type: "channel_history", payload: { channel: "doc:42" } });
            await service.handleClientMessage("member", {
                type: "broadcast",
                payload: { channel: "doc:42", event: "op", payload: { n: 1 } }
            });

            expect(framesOfType(member, "presence_state")).toHaveLength(1);
            expect(framesOfType(member, "channel_history")).toHaveLength(1);
            expect(framesOfType(other, "broadcast")).toHaveLength(1);
            expect(framesOfType(member, "error")).toHaveLength(0);
        });

        it("leaving and untracking need no permission", async () => {
            const ws = createClient(service, "c1");

            await service.handleClientMessage("c1", { type: "leave_channel", payload: { channel: "doc:42" } });
            await service.handleClientMessage("c1", { type: "presence_untrack", payload: { channel: "doc:42" } });

            expect(framesOfType(ws, "error")).toHaveLength(0);
        });

        it("processes join → presence_state sent in the same tick in arrival order", async () => {
            // The socket's message handler runs each frame up to its first
            // `await`, so a gate that always yielded would let the read that
            // follows a join be refused by the join that has not landed yet.
            // The client sends exactly this sequence on every connect.
            const ws = createClient(service, "c1");

            const join = service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "doc:42" } });
            const read = service.handleClientMessage("c1", { type: "presence_state", payload: { channel: "doc:42" } });
            await Promise.all([join, read]);

            expect(framesOfType(ws, "presence_state")).toHaveLength(1);
            expect(framesOfType(ws, "error")).toHaveLength(0);
        });
    });

    describe("the authorizer seam", () => {
        it("can refuse a join that membership alone would allow", async () => {
            const ws = createClient(service, "c1");
            service.setChannelAuthorizer(({ action, channel }) => !(action === "join" && channel === "doc:42"));

            await service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "doc:42" } });
            await service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "doc:7" } });

            expect(framesOfType(ws, "error")).toHaveLength(1);
            expect(framesOfType(ws, "error")[0].payload.error.code).toBe("CHANNEL_FORBIDDEN");

            // The refused channel really has no member — refusing the reply but
            // performing the join would be worse than not checking at all.
            ws.send.mockClear();
            await service.handleClientMessage("c1", { type: "presence_state", payload: { channel: "doc:42" } });
            expect(framesOfType(ws, "presence_state")).toHaveLength(0);
        });

        it("sees the action and the socket's principal", async () => {
            createClient(service, "c1");
            const seen: Array<Record<string, unknown>> = [];
            service.setChannelAuthorizer((request) => { seen.push({ ...request }); return true; });

            await service.handleClientMessage(
                "c1",
                { type: "join_channel", payload: { channel: "doc:42" } },
                { uid: "user-1", roles: ["editor"] }
            );
            await service.handleClientMessage(
                "c1",
                { type: "broadcast", payload: { channel: "doc:42", event: "op" } },
                { uid: "user-1", roles: ["editor"] }
            );

            expect(seen).toEqual([
                { channel: "doc:42", action: "join", clientId: "c1", user: { uid: "user-1", roles: ["editor"] } },
                { channel: "doc:42", action: "broadcast", clientId: "c1", user: { uid: "user-1", roles: ["editor"] } }
            ]);
        });

        it("fails closed when the authorizer throws or rejects", async () => {
            const ws = createClient(service, "c1");
            service.setChannelAuthorizer(() => { throw new Error("rules backend down"); });

            await service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "doc:42" } });
            expect(framesOfType(ws, "error")[0].payload.error.code).toBe("CHANNEL_FORBIDDEN");

            ws.send.mockClear();
            service.setChannelAuthorizer(() => Promise.reject(new Error("rules backend down")));
            await service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "doc:7" } });
            expect(framesOfType(ws, "error")[0].payload.error.code).toBe("CHANNEL_FORBIDDEN");

            // Neither attempt made the client a member of anything.
            ws.send.mockClear();
            service.setChannelAuthorizer(undefined);
            await service.handleClientMessage("c1", { type: "broadcast", payload: { channel: "doc:42", event: "op" } });
            expect(framesOfType(ws, "error")[0].payload.error.code).toBe("CHANNEL_FORBIDDEN");
        });

        it("cannot widen access past the membership floor", async () => {
            const ws = createClient(service, "c1");
            service.setChannelAuthorizer(() => true);

            await service.handleClientMessage("c1", { type: "presence_state", payload: { channel: "doc:42" } });

            expect(framesOfType(ws, "presence_state")).toHaveLength(0);
            expect(framesOfType(ws, "error")[0].payload.error.code).toBe("CHANNEL_FORBIDDEN");
        });
    });

    describe("the memory bus on a multi-pod deployment", () => {
        it("warns once, and only once another instance has been seen", () => {
            const warn = jest.spyOn(require("@rebasepro/server").logger, "warn").mockImplementation(() => {});
            const matching = () => warn.mock.calls.filter((call) => String(call[0]).includes("realtime.bus"));

            createClient(service, "c1");
            service.joinChannel("c1", "room:1");
            expect(matching()).toHaveLength(0);

            // What the entity LISTEN handler learns on every cross-instance
            // notification: a sid that is not ours.
            (service as unknown as { foreignInstanceSeen: boolean }).foreignInstanceSeen = true;

            service.joinChannel("c1", "room:2");
            service.joinChannel("c1", "room:3");
            expect(matching()).toHaveLength(1);

            warn.mockRestore();
        });
    });
});
