import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * A socket that signs in again is read as the identity it has now.
 *
 * The SDK re-authenticates its socket on every session refresh, and the docs
 * promise that a role taken away or a tenant claim removed changes what an
 * open socket may read once it does. Requests did change; every live
 * subscription kept refetching under the roles and claims it was opened with,
 * so a demoted user went on receiving editor-only rows for as long as the view
 * stayed mounted.
 */

const mockFetchCollection = jest.fn(async () => [{ id: 1, title: "Row" }]);
const mockFetchEntity = jest.fn(async () => ({ id: 1, title: "Row" }));
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: mockFetchCollection,
        fetchOneForRest: mockFetchEntity,
        count: jest.fn(async () => 1),
        cursorFor: jest.fn().mockReturnValue(undefined),
        fetchCollection: mockFetchCollection,
        fetchOne: mockFetchEntity,
        searchRows: jest.fn(async () => [])
    }))
}));

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { RealtimeService, type SubscriptionAuthContext } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";

const posts = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "number", isId: true },
        title: { type: "string" },
        // Only editors may read it.
        score: { type: "number", access: { read: ["editor"] } }
    }
} as unknown as CollectionConfig;

const EDITOR: SubscriptionAuthContext = { uid: "u1", roles: ["editor"] };
const VIEWER: SubscriptionAuthContext = { uid: "u1", roles: ["viewer"] };

async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

let service: RealtimeService;
let ws: { readyState: number; send: jest.Mock; on: jest.Mock };
let statements: string[];

beforeEach(() => {
    jest.useFakeTimers();
    statements = [];
    const db = {
        execute: jest.fn(async (statement: unknown) => {
            statements.push(JSON.stringify(statement));
            return { rows: [] };
        }),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    } as unknown as NodePgDatabase<Record<string, never>>;
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts]);
    service = new RealtimeService(db, registry);
    service.setDataDriver({ fetchCollection: mockFetchCollection, fetchOne: mockFetchEntity } as never);
    ws = { readyState: 1, send: jest.fn(), on: jest.fn() };
    service.addClient("c1", ws as never);
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

const frames = () => ws.send.mock.calls.map(([frame]) => JSON.parse(frame as string) as {
    type: string; subscriptionId?: string; payload?: { error?: { code?: string } }; error?: unknown; code?: string;
});

/** The roles the refetches since `from` ran as, read off the `set_config` they issued. */
const rolesSince = (from: number) => statements.slice(from).join("\n");

describe("rescopeClient", () => {
    it("refetches every subscription as the new identity, at once", async () => {
        await service.handleClientMessage("c1", { type: "subscribe_collection", payload: { path: "posts", subscriptionId: "list" } }, EDITOR);
        await service.handleClientMessage("c1", { type: "subscribe_one", payload: { path: "posts", id: "1", subscriptionId: "one" } }, EDITOR);
        await flush();
        ws.send.mockClear();
        const before = statements.length;

        await service.rescopeClient("c1", VIEWER);
        jest.advanceTimersByTime(350);
        await flush();

        expect(rolesSince(before)).toContain("viewer");
        expect(rolesSince(before)).not.toContain("editor");
        expect(frames().map(f => f.subscriptionId).sort()).toEqual(["list", "one"]);
    });

    it("keeps refetching as the new identity on the next write", async () => {
        await service.handleClientMessage("c1", { type: "subscribe_collection", payload: { path: "posts", subscriptionId: "list" } }, EDITOR);
        await flush();
        await service.rescopeClient("c1", VIEWER);
        jest.advanceTimersByTime(350);
        await flush();
        const before = statements.length;

        await service.notifyUpdate("posts", "1", null);
        jest.advanceTimersByTime(350);
        await flush();

        expect(rolesSince(before)).toContain("viewer");
        expect(rolesSince(before)).not.toContain("editor");
    });

    it("ends a subscription filtered on a field the new roles may not read", async () => {
        await service.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "posts", subscriptionId: "by-score", filter: { score: [">", 10] } }
        }, EDITOR);
        await flush();
        ws.send.mockClear();
        mockFetchCollection.mockClear();

        await service.rescopeClient("c1", VIEWER);
        jest.advanceTimersByTime(350);
        await flush();
        await service.notifyUpdate("posts", "1", null);
        jest.advanceTimersByTime(350);
        await flush();

        expect(mockFetchCollection).not.toHaveBeenCalled();
        expect(JSON.stringify(frames())).toContain("FIELD_NOT_READABLE");
    });

    it("puts channel memberships to the authorizer again and leaves the ones it refuses", async () => {
        service.setChannelAuthorizer(({ user }) => (user?.roles ?? []).includes("editor"));
        await service.handleClientMessage("c1", { type: "join_channel", payload: { channel: "editors" } }, EDITOR);
        ws.send.mockClear();

        await service.rescopeClient("c1", VIEWER);

        expect(JSON.stringify(frames())).toContain("CHANNEL_FORBIDDEN");
        await service.handleClientMessage("c1", { type: "channel_history", payload: { channel: "editors" } }, EDITOR);
        expect(JSON.stringify(frames())).toContain("not a member of the channel");
    });
});
