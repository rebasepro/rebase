import type { CollectionUpdateMessage, WebSocketMessage } from "@rebasepro/types";
import type { RebaseWebSocketClient } from "../../src/websocket";

/**
 * Reach into a realtime client's private subscription table.
 *
 * The merge tests assert *identity* — that a row which did not change keeps
 * the very object the client held. A subscription built through a socket holds
 * the parser's objects, not the test's, so these seed the table directly and
 * read it back, by name. Each read checks the shape it gets.
 */

/** The backend subscription id the seeded subscription answers to. */
export const SEEDED_SUBSCRIPTION_ID = "backend-1";
const SEEDED_KEY = "sub-key";

function privateMap(client: RebaseWebSocketClient, name: string): Map<string, unknown> {
    const value: unknown = Reflect.get(client, name);
    if (!(value instanceof Map)) throw new Error(`RebaseWebSocketClient.${name} is not a Map`);
    return value;
}

/**
 * Seed one collection subscription, answering to {@link SEEDED_SUBSCRIPTION_ID}.
 * `subscription` is the client's own record for it (`latestData`, `props`,
 * `callbacks`, `pks`, …).
 */
export function seedCollectionSubscription(client: RebaseWebSocketClient, subscription: Record<string, unknown>): void {
    privateMap(client, "backendToCollectionKey").set(SEEDED_SUBSCRIPTION_ID, SEEDED_KEY);
    privateMap(client, "collectionSubscriptions").set(SEEDED_KEY, subscription);
}

/** The rows the seeded subscription holds now. */
export function heldRows(client: RebaseWebSocketClient): Record<string, unknown>[] {
    const subscription = privateMap(client, "collectionSubscriptions").get(SEEDED_KEY);
    const rows: unknown = typeof subscription === "object" && subscription !== null
        ? Reflect.get(subscription, "latestData")
        : undefined;
    if (!Array.isArray(rows)) throw new Error("the seeded subscription holds no rows");
    return rows;
}

/** Hand the client a frame as if its socket had received it. */
export function deliverFrame(client: RebaseWebSocketClient, message: WebSocketMessage | CollectionUpdateMessage): void {
    const handler: unknown = Reflect.get(client, "handleWebSocketMessage");
    if (typeof handler !== "function") throw new Error("RebaseWebSocketClient.handleWebSocketMessage is gone");
    handler.call(client, message);
}
