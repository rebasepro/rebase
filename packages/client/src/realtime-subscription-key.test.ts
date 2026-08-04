import { jest } from "@jest/globals";
import { RebaseWebSocketClient } from "./websocket";
import { or, cond } from "@rebasepro/common";

/**
 * Two subscriptions are the same subscription only when they ask for the same
 * rows. The key that decides this was built from a hand-listed subset of the
 * props, so any field left off it made two different queries collide — and the
 * second listener was handed the first one's rows, which is worse than not
 * subscribing at all.
 */

function fakeSocket() {
    const sent: Record<string, unknown>[] = [];

    class FakeWS {
        static readonly OPEN = 1;
        readyState = 1;
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;

        constructor(public url: string) {
            setTimeout(() => this.onopen?.(), 0);
        }

        send(raw: string) {
            const message = JSON.parse(raw) as Record<string, unknown>;
            sent.push(message);
            if (message.type === "AUTHENTICATE") {
                setTimeout(() => this.onmessage?.({
                    data: JSON.stringify({ type: "AUTH_SUCCESS", requestId: message.requestId })
                }), 0);
            }
        }

        close() { /* noop */ }
    }

    return { FakeWS: FakeWS as unknown as typeof WebSocket, sent };
}

function subscribeFrames(sent: Record<string, unknown>[]) {
    return sent.filter((m) => m.type === "subscribe_collection");
}

describe("collection subscription identity", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    async function twoSubscriptions(
        a: Record<string, unknown>,
        b: Record<string, unknown>
    ) {
        const { FakeWS, sent } = fakeSocket();
        const client = new RebaseWebSocketClient({
            websocketUrl: "ws://localhost:1234",
            WebSocket: FakeWS,
            getAuthToken: async () => "token"
        });
        client.listenCollection({ path: "posts", ...a } as never, () => {});
        client.listenCollection({ path: "posts", ...b } as never, () => {});
        await jest.advanceTimersByTimeAsync(50);
        return subscribeFrames(sent);
    }

    it("treats different offsets as different subscriptions", async () => {
        // Page one and page two of the same live list. Sharing a subscription
        // here shows page one's rows on page two.
        const frames = await twoSubscriptions({ limit: 10, offset: 0 }, { limit: 10, offset: 10 });
        expect(frames).toHaveLength(2);
    });

    it("treats different logical groups as different subscriptions", async () => {
        const frames = await twoSubscriptions(
            { logical: or(cond("status", "==", "draft")) },
            { logical: or(cond("status", "==", "published")) }
        );
        expect(frames).toHaveLength(2);
    });

    it("still shares one subscription for genuinely identical queries", async () => {
        // The de-duplication itself is the point of the key: two components
        // watching the same list must not open two server subscriptions.
        const frames = await twoSubscriptions(
            { limit: 10, offset: 10, logical: or(cond("status", "==", "draft")) },
            { limit: 10, offset: 10, logical: or(cond("status", "==", "draft")) }
        );
        expect(frames).toHaveLength(1);
    });
});
