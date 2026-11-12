import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { CollectionConfig } from "@rebasepro/types";
import { WebSocket } from "ws";
import { recordingDb } from "./helpers/spg-c-db";
import { fakeRealtimeSocket, type FakeRealtimeSocket } from "./helpers/spg-c-socket";

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(null),
        searchRows: jest.fn().mockResolvedValue([])
    }))
}));

type MockWebSocket = FakeRealtimeSocket;

/** An open socket that, closed, reads as closed. */
function mockWebSocket(): MockWebSocket {
    const ws = fakeRealtimeSocket();
    ws.close.mockImplementation(() => { ws.readyState = WebSocket.CLOSED; });
    return ws;
}

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { id: { type: "number" } }
};

function createService() {
    const { db } = recordingDb();
    const registry = new FixtureTableRegistry();
    jest.spyOn(registry, "getCollectionByPath").mockReturnValue(postsCollection);
    return new RealtimeService(db, registry);
}

function createClient(service: RealtimeService, clientId: string): MockWebSocket {
    const ws = mockWebSocket();
    service.addClient(clientId, ws);
    return ws;
}

const errorCodes = (ws: MockWebSocket): unknown[] =>
    ws.send.mock.calls
        .map((call) => JSON.parse(call[0] as string) as { type: string; payload?: { error?: { code?: string } } })
        .filter((frame) => frame.type === "error")
        .map((frame) => frame.payload?.error?.code);

/**
 * A channel frame names its channel with a non-empty string.
 *
 * The name was read as `payload.channel as string`, so a number reached the
 * in-memory channel map as a key of its own while the shared presence and
 * history tables read it as the text "1": the authorizer was asked about one
 * channel and the rows of another came back. A missing name made a channel
 * called `undefined`.
 */
describe("RealtimeService — a channel's name", () => {
    let service: RealtimeService;

    beforeEach(() => {
        service = createService();
    });

    afterEach(async () => {
        await service.destroy();
        jest.clearAllMocks();
    });

    it.each([
        ["a number", 1],
        ["an object", { name: "doc:42" }],
        ["an empty string", ""],
        ["nothing", undefined]
    ])("refuses %s, and joins nothing", async (_label, channel) => {
        const ws = createClient(service, "c1");

        await service.handleClientMessage("c1", { type: "join_channel", payload: { channel } });

        expect(errorCodes(ws)).toEqual(["INVALID_CHANNEL"]);
    });

    it("still joins a channel named by a string", async () => {
        const ws = createClient(service, "c1");

        await service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "doc:42" } });

        expect(errorCodes(ws)).toEqual([]);
    });
});
