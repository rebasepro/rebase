import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * A socket that signs in again with fewer roles has every subscription it
 * holds judged again — including the relations it loads.
 *
 * A subscribe frame whose `include` filters or sorts a relation's target on a
 * field the subscriber may not read is refused (`FIELD_NOT_READABLE`): the
 * related rows that come back answer the predicate even with the value
 * stripped. Re-judged on a sign-in, a list's filter, sort and projection were
 * checked and its `include` was not, and a row subscription's `include` was not
 * checked at all — so an HR user demoted to a plain user went on receiving, in
 * every frame, exactly the staff paid over the line.
 */

const mockFetchCollection = jest.fn(async () => [{ id: 1, name: "Ops" }]);
const mockFetchEntity = jest.fn(async () => ({ id: 1, name: "Ops" }));
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

import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { RealtimeService, type SubscriptionAuthContext } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { recordingDb } from "./helpers/spg-c-db";
import { fakeDataDriver, fakeRealtimeSocket, type FakeRealtimeSocket } from "./helpers/spg-c-socket";

const staff: LegacyCollectionConfig = {
    name: "Staff",
    slug: "staff",
    table: "staff",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } }
    }
};

const depts: LegacyCollectionConfig = {
    name: "Depts",
    slug: "depts",
    table: "depts",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        staff: { name: "Staff", type: "relation", relation: { kind: "hasMany", target: () => staff, foreignKeyOnTarget: "dept_id" } }
    }
};

const HR: SubscriptionAuthContext = { uid: "u1", roles: ["hr"] };
const DEMOTED: SubscriptionAuthContext = { uid: "u1", roles: ["user"] };
const OVER_THE_LINE = { staff: { where: { salary: [">", 100000] } } };

async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

let service: RealtimeService;
let ws: FakeRealtimeSocket;

beforeEach(() => {
    jest.useFakeTimers();
    const { db } = recordingDb();
    const registry = new FixtureTableRegistry();
    registry.registerMultiple([staff, depts]);
    service = new RealtimeService(db, registry);
    service.setDataDriver({ ...fakeDataDriver(), fetchCollection: mockFetchCollection, fetchOne: mockFetchEntity });
    ws = fakeRealtimeSocket();
    service.addClient("c1", ws);
});

afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
});

const errorCodes = () => ws.send.mock.calls
    .map(([frame]) => JSON.parse(frame as string) as { type: string; subscriptionId?: string; payload?: { error?: { code?: string } } })
    .filter(frame => frame.type === "error")
    .map(frame => [frame.subscriptionId, frame.payload?.error?.code]);

describe("rescopeClient and include", () => {
    it("ends a list subscription whose include filters on a field the new roles may not read", async () => {
        await service.handleClientMessage("c1", {
            type: "subscribe_collection",
            payload: { path: "depts", subscriptionId: "list", include: OVER_THE_LINE }
        }, HR);
        await flush();
        expect(errorCodes()).toEqual([]);
        mockFetchCollection.mockClear();

        await service.rescopeClient("c1", DEMOTED);
        jest.advanceTimersByTime(350);
        await flush();
        await service.notifyUpdate("depts", "1", null);
        jest.advanceTimersByTime(1500);
        await flush();

        expect(mockFetchCollection).not.toHaveBeenCalled();
        expect(errorCodes()).toEqual([["list", "FIELD_NOT_READABLE"]]);
    });

    it("ends a row subscription whose include filters on a field the new roles may not read", async () => {
        await service.handleClientMessage("c1", {
            type: "subscribe_one",
            payload: { path: "depts", id: "1", subscriptionId: "one", include: OVER_THE_LINE }
        }, HR);
        await flush();
        expect(errorCodes()).toEqual([]);
        mockFetchEntity.mockClear();

        await service.rescopeClient("c1", DEMOTED);
        jest.advanceTimersByTime(350);
        await flush();
        await service.notifyUpdate("depts", "1", null);
        jest.advanceTimersByTime(1500);
        await flush();

        expect(mockFetchEntity).not.toHaveBeenCalled();
        expect(errorCodes()).toEqual([["one", "FIELD_NOT_READABLE"]]);
    });

    it("keeps a subscription whose include names only fields the new roles may read", async () => {
        await service.handleClientMessage("c1", {
            type: "subscribe_one",
            payload: { path: "depts", id: "1", subscriptionId: "one", include: { staff: { where: { name: ["==", "ann"] } } } }
        }, HR);
        await flush();
        mockFetchEntity.mockClear();

        await service.rescopeClient("c1", DEMOTED);
        jest.advanceTimersByTime(350);
        await flush();

        expect(errorCodes()).toEqual([]);
        expect(mockFetchEntity).toHaveBeenCalledTimes(1);
    });
});
