import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * A single-row subscription reads the relations it names, first frame and every
 * refetch after it.
 *
 * It took no `include` at all, so its frames never carried a to-many relation:
 * the key was absent. The admin's record form opened by URL (nothing in the
 * cache to fall back on) showed a many-to-many field empty, and a tag added to
 * it was saved as the whole set — a many-to-many save sets membership, so every
 * stored tag was unlinked. A list subscription has always taken `include`; the
 * row subscription now takes the same thing, with the same readability check.
 */

const fetchOneForRest = jest.fn(async (..._args: unknown[]) => ({ id: 1, title: "Row" }));
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: jest.fn(async () => []),
        fetchOneForRest,
        count: jest.fn(async () => 0),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { RealtimeService, type SubscriptionAuthContext } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const tags = {
    slug: "tags",
    name: "Tags",
    table: "tags",
    properties: { id: { type: "number", isId: true }, name: { type: "string" } }
} as unknown as CollectionConfig;

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;

const ALICE: SubscriptionAuthContext = { uid: "alice", roles: ["editor"] };

type Socket = { readyState: number; send: jest.Mock; on: jest.Mock; close: jest.Mock; terminate: jest.Mock };

let service: RealtimeService;

async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

function connect(clientId: string): Socket {
    const ws: Socket = { readyState: 1, send: jest.fn(), on: jest.fn(), close: jest.fn(), terminate: jest.fn() };
    service.addClient(clientId, ws as never);
    return ws;
}

const frames = (ws: Socket) => ws.send.mock.calls.map(([frame]) => JSON.parse(frame as string) as {
    type: string; subscriptionId?: string; row?: unknown;
});

/** The `include` each row read was asked for, in order. */
const includesRead = () => fetchOneForRest.mock.calls.map((args) => args[2]);

async function write() {
    await service.notifyUpdate("posts", "1", { _rebase_invalidated: true });
    jest.advanceTimersByTime(350);
    await flush();
}

beforeEach(() => {
    jest.useFakeTimers();
    const db = {
        execute: jest.fn(async () => ({ rows: [] })),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    } as unknown as NodePgDatabase<Record<string, never>>;
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts, tags]);
    service = new RealtimeService(db, registry);
    service.setDataDriver({ callContextWithin: () => ({}) } as never);
    fetchOneForRest.mockClear();
    let version = 0;
    fetchOneForRest.mockImplementation(async () => ({ id: 1, title: `Row ${++version}` }));
});

afterEach(async () => {
    await service.destroy();
    jest.useRealTimers();
});

describe("a single-row subscription with an include", () => {
    it("reads the relations it names, first and on every refetch", async () => {
        connect("a");
        await service.handleClientMessage("a", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "one", include: ["tags"] }
        }, ALICE);
        await flush();
        await write();

        expect(includesRead()).toEqual([["tags"], ["tags"]]);
    });

    it("is not answered by the read of a subscriber that named no relation", async () => {
        const a = connect("a");
        const b = connect("b");
        await service.handleClientMessage("a", { type: "subscribe_one", payload: { path: "posts", id: "1", subscriptionId: "s" } }, ALICE);
        await service.handleClientMessage("b", { type: "subscribe_one", payload: { path: "posts", id: "1", subscriptionId: "s", include: ["tags"] } }, ALICE);
        await flush();
        fetchOneForRest.mockClear();
        a.send.mockClear();
        b.send.mockClear();

        await write();

        expect(includesRead()).toHaveLength(2);
        expect(includesRead()).toContainEqual(["tags"]);
        expect(includesRead()).toContainEqual(undefined);
        expect(frames(a).filter((f) => f.type === "single_update")).toHaveLength(1);
        expect(frames(b).filter((f) => f.type === "single_update")).toHaveLength(1);
    });

    it("reads the relations an in-process row listener names", async () => {
        service.startDataDriverSubscription("listener", { type: "single", path: "posts", id: "1", include: ["tags"], authContext: ALICE }, () => undefined);
        await flush();
        await write();

        expect(includesRead()).toEqual([["tags"], ["tags"]]);
    });

    it("is refused, like a list's, when its include filters on a field the subscriber may not read", async () => {
        const guardedTags = {
            ...tags,
            properties: { ...tags.properties, secret: { type: "string", access: { read: ["admin"] } } }
        } as unknown as CollectionConfig;
        const guardedPosts = {
            ...posts,
            properties: { ...posts.properties, tags: { type: "relation", relation: { kind: "manyToMany", target: () => guardedTags } } }
        } as unknown as CollectionConfig;
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([guardedPosts, guardedTags]);
        await service.destroy();
        const db = {
            execute: jest.fn(async () => ({ rows: [] })),
            transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
        };
        service = new RealtimeService(db as never, registry);
        service.setDataDriver({ callContextWithin: () => ({}) } as never);
        const ws = connect("a");

        await service.handleClientMessage("a", {
            type: "subscribe_one",
            payload: { path: "posts", id: "1", subscriptionId: "one", include: { tags: { where: { secret: ["==", "x"] } } } }
        }, ALICE);
        await flush();

        expect(fetchOneForRest).not.toHaveBeenCalled();
        expect(frames(ws).map((f) => f.type)).toContain("error");
    });
});
