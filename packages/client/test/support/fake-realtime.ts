import { jest } from "@jest/globals";
import type { CollectionRealtime } from "../../src/collection";

/** What a collection listener and a row listener are handed. */
export type RowsListener = Parameters<CollectionRealtime["listenCollection"]>[1];
export type RowListener = Parameters<CollectionRealtime["listenOne"]>[1];

/**
 * A realtime stand-in for a collection client: both listeners are jest mocks
 * answering with `unsubscribe`, and the callbacks they were last given are
 * kept in `listeners`, so a test can push rows through them.
 */
export function mockRealtime(unsubscribe: () => void = () => {}) {
    const listeners: { collection?: RowsListener; one?: RowListener } = {};
    const realtime = {
        listenCollection: jest.fn<CollectionRealtime["listenCollection"]>((_props, onUpdate) => {
            listeners.collection = onUpdate;
            return unsubscribe;
        }),
        listenOne: jest.fn<CollectionRealtime["listenOne"]>((_props, onUpdate) => {
            listeners.one = onUpdate;
            return unsubscribe;
        })
    };
    return { realtime, listeners };
}
