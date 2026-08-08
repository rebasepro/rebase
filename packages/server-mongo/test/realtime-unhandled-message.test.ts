import { Db } from "mongodb";
import { WebSocket } from "ws";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";

/**
 * A silent `switch` over a wire protocol.
 *
 * `handleClientMessage` had arms for `subscribe_collection`, `subscribe_one`
 * and `unsubscribe`, and no `default`. Channel, presence and broadcast frames —
 * which the multi-engine router used to hand to whichever provider was marked
 * default, Mongo included — fell off the end of it: no error, no log, no reply.
 * The client's `broadcast()` resolved, `onPresence` never fired, and every
 * `channel_history` request sat unanswered until the catch-up timeout.
 */
describe("MongoRealtimeService — unhandled message types", () => {
    let service: MongoRealtimeService;
    let ws: { send: jest.Mock; on: jest.Mock };

    beforeEach(() => {
        service = new MongoRealtimeService({ collection: jest.fn() } as unknown as Db);
        ws = { send: jest.fn(), on: jest.fn() };
        service.addClient("c1", ws as unknown as WebSocket);
    });

    it.each([
        "join_channel",
        "broadcast",
        "presence_track",
        "presence_state",
        "channel_history"
    ])("answers %s rather than dropping it", async (type: string) => {
        await service.handleClientMessage("c1", { type, payload: { channel: "doc:42" } });

        expect(ws.send).toHaveBeenCalledTimes(1);
        const frame = JSON.parse(ws.send.mock.calls[0][0] as string);
        expect(frame.type).toBe("ERROR");
        expect(frame.payload.error.code).toBe("REALTIME_UNSUPPORTED");
        expect(frame.payload.error.message).toContain(type);
    });

    it("leaves the types it does implement alone", async () => {
        await service.handleClientMessage("c1", { type: "unsubscribe", payload: { subscriptionId: "s1" } });
        expect(ws.send).not.toHaveBeenCalled();
    });
});
