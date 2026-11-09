/**
 * A frame whose socket closed before it was handled leaves nothing behind.
 *
 * The socket door awaits before it hands a frame to the realtime service — the
 * identity recheck, the data rate limiter — and a channel join awaits again for
 * an asynchronous channel authorizer. A client that closes inside one of those
 * awaits has already been removed (`removeClient` runs on `close`) by the time
 * the frame lands, and the frame used to register anyway: a subscription
 * owned by a socket that no longer exists, kept in its group and refetched on
 * every write to its path for the life of the process, or a channel membership
 * that keeps the channel — and its bus subscription — alive forever. Each
 * subscribe-and-close left one more, so a client could grow the server's
 * memory without bound.
 */
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { CollectionConfig } from "@rebasepro/types";
import { WebSocket } from "ws";
import type { ClientSocket } from "../src/services/socket-liveness";
import { transactionalDrizzle } from "./helpers/spg-a-db";

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(null),
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

class MockWebSocket implements ClientSocket {
    public readyState: ClientSocket["readyState"] = WebSocket.OPEN;
    public bufferedAmount = 0;
    public send = jest.fn();
    public on = jest.fn();
    public close = jest.fn(() => { this.readyState = WebSocket.CLOSED; });
    public terminate = jest.fn();
}

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "number" } }
};

function createService() {
    const { db } = transactionalDrizzle();
    const registry = new PostgresCollectionRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockReturnValue(postsCollection);
    return new RealtimeService(db, registry);
}

describe("a frame from a socket that has already closed", () => {
    let service: RealtimeService;

    beforeEach(() => {
        service = createService();
    });

    afterEach(async () => {
        await service.destroy();
        jest.clearAllMocks();
    });

    it("registers no collection subscription", async () => {
        service.addClient("c1", new MockWebSocket());
        await service.removeClient("c1");

        await service.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-1" }
        });

        expect(service.subscriptions.size).toBe(0);
    });

    it("registers no single-row subscription", async () => {
        service.addClient("c1", new MockWebSocket());
        await service.removeClient("c1");

        await service.handleClientMessage("c1", {
            type: "subscribe_one",
            payload: { path: "posts", id: 1, subscriptionId: "sub-1" }
        });

        expect(service.subscriptions.size).toBe(0);
    });

    it("joins no channel when it closes while the channel authorizer decides", async () => {
        let decide: (ok: boolean) => void = () => undefined;
        service.setChannelAuthorizer(() => new Promise<boolean>((resolve) => { decide = resolve; }));
        service.addClient("c1", new MockWebSocket());

        const joining = service.handleClientMessage("c1", {
            type: "join_channel",
            payload: { channel: "room:1" }
        });
        await service.removeClient("c1");
        decide(true);
        await joining;

        expect(service.counts().channels).toBe(0);
    });

    it("still subscribes and joins for a socket that is open", async () => {
        service.addClient("c1", new MockWebSocket());

        await service.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "sub-1" }
        });
        await service.handleClientMessage("c1", {
            type: "join_channel",
            payload: { channel: "room:1" }
        });

        expect(service.subscriptions.size).toBe(1);
        expect(service.counts().channels).toBe(1);
    });
});
