import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * Which list subscriptions a row change asks to look again.
 *
 * A change can only alter a list whose filter matched the row before it or
 * matches it after, so a list of `owner == "bob"` is not refetched when
 * Alice's row changes. These tests pin both halves of that: a group is
 * skipped only when the change *proves* its filter cannot match, and every
 * group that is asked still reads under its own principal — a pre-filter that
 * says "may match" never hands anyone a row their scope hides, because it
 * decides who reads, never what they are sent.
 */

const fetchCollectionForRest = jest.fn(async (..._args: unknown[]) => [] as Record<string, unknown>[]);
const fetchOneForRest = jest.fn(async (..._args: unknown[]): Promise<Record<string, unknown> | null> => null);
const count = jest.fn(async (..._args: unknown[]) => 0);
jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest,
        fetchOneForRest,
        count,
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { RealtimeService, type SubscriptionAuthContext } from "../src/services/realtimeService";
import {
    canonicalValue,
    changeMayReach,
    compileListPrefilter,
    NULL_KEY,
    type RowChangeImage
} from "../src/services/realtime-prefilter";
import { FixtureTableRegistry } from "./helpers/tables";
import { fakeCallContextDriver, fakeRealtimeSocket } from "./helpers/spg-c-socket";
import { recordingDb, type RecordedStatement } from "./helpers/spg-c-db";

const notes: LegacyCollectionConfig = {
    slug: "notes",
    name: "Notes",
    table: "notes",
    properties: {
        id: { type: "number", isId: "increment" },
        owner: { type: "string" },
        title: { type: "string" },
        pinned: { type: "boolean" }
    }
};

const ALICE: SubscriptionAuthContext = { uid: "alice", roles: ["user"] };
const BOB: SubscriptionAuthContext = { uid: "bob", roles: ["user"] };
const CAROL: SubscriptionAuthContext = { uid: "carol", roles: ["user"] };

let registry: FixtureTableRegistry;
let service: RealtimeService;
let statements: RecordedStatement[];

async function flush() {
    for (let i = 0; i < 40; i++) await Promise.resolve();
}

function subscribe(clientId: string, auth: SubscriptionAuthContext, filter?: Record<string, unknown>) {
    service.addClient(clientId, fakeRealtimeSocket());
    return service.handleClientMessage(clientId, {
        type: "subscribe_collection",
        payload: { path: "notes", subscriptionId: "s", ...(filter ? { filter } : {}) }
    }, auth);
}

/** Who read since `from`, by the uid each refetch transaction was scoped to. */
const readersSince = (from: number) =>
    [...new Set(statements.slice(from).flatMap(s => [...JSON.stringify(s).matchAll(/\b(alice|bob|carol|dave)\b/g)].map(m => m[1])))].sort();

/** Notify a change, let the debounce pass, and answer who refetched. */
async function refetchedBy(image?: RowChangeImage, id = "1"): Promise<string[]> {
    const from = statements.length;
    fetchCollectionForRest.mockClear();
    await service.notifyUpdate("notes", id, { _rebase_invalidated: true }, undefined, true, "app", image);
    jest.advanceTimersByTime(1500);
    await flush();
    return readersSince(from);
}

beforeEach(async () => {
    jest.useFakeTimers();
    const recording = recordingDb();
    statements = recording.statements;
    registry = new FixtureTableRegistry();
    registry.registerMultiple([notes]);
    service = new RealtimeService(recording.db, registry);
    service.setDataDriver(fakeCallContextDriver());
    fetchCollectionForRest.mockClear();

    // Each user watches their own notes; Carol watches every note she may see.
    await subscribe("a", ALICE, { owner: ["==", "alice"] });
    await subscribe("b", BOB, { owner: ["==", "bob"] });
    await subscribe("c", CAROL);
    await flush();
});

afterEach(async () => {
    await service.destroy();
    jest.useRealTimers();
});

describe("a change the write path can describe", () => {
    it("asks only the lists whose filter the row matches, and every unfiltered one", async () => {
        expect(await refetchedBy({ before: null, after: { id: 1, owner: "alice", title: "t" } })).toEqual(["alice", "carol"]);
    });

    it("asks both owners' lists when a row moves from one to the other", async () => {
        expect(await refetchedBy({ before: { id: 1, owner: "alice" }, after: { id: 1, owner: "bob" } })).toEqual(["alice", "bob", "carol"]);
    });

    it("asks nobody filtered when the row belongs to no subscriber", async () => {
        expect(await refetchedBy({ before: { id: 1, owner: "dave" }, after: null })).toEqual(["carol"]);
    });

    it("refetches as the subscriber: the list that matched reads under its own principal, not the writer's", async () => {
        const from = statements.length;
        await service.notifyUpdate("notes", "1", { _rebase_invalidated: true }, undefined, true, "app", { before: null, after: { owner: "bob" } });
        jest.advanceTimersByTime(1500);
        await flush();
        const scoped = statements.slice(from).map(s => JSON.stringify(s)).filter(s => s.includes("set_config"));
        expect(scoped.some(s => s.includes("bob"))).toBe(true);
        expect(scoped.some(s => s.includes("alice"))).toBe(false);
    });
});

describe("a change that cannot be judged asks every list (the 8 KB overflow, a key-only trigger, an unknown old row)", () => {
    it("with no image at all", async () => {
        expect(await refetchedBy(undefined)).toEqual(["alice", "bob", "carol"]);
    });

    it("with the old version unknown — an update whose pre-read was skipped", async () => {
        expect(await refetchedBy({ after: { id: 1, owner: "alice" } })).toEqual(["alice", "bob", "carol"]);
    });

    it("with the filtered column missing from a version — a key-only tuple", async () => {
        expect(await refetchedBy({ before: null, after: { id: 1 } })).toEqual(["alice", "bob", "carol"]);
    });

    it("with a value it cannot compare as Postgres would", async () => {
        expect(await refetchedBy({ before: null, after: { id: 1, owner: { not: "text" } } })).toEqual(["alice", "bob", "carol"]);
    });
});

describe("what a captured change carries", () => {
    it("a WAL insert names the row's values, and reaches only its owner's list", async () => {
        const from = statements.length;
        // Through the CDC entry point, as the WAL listener hands it over.
        service["cdcTableMap"] = new Map([["public.notes", registry.tableAt("notes")!]]);
        await service["handleCdcEvent"]({
            schema: "public", table: "notes", op: "INSERT", row: { id: "9" },
            values: { before: null, after: { id: "9", owner: "bob", title: "x" } }
        });
        jest.advanceTimersByTime(1500);
        await flush();
        expect(readersSince(from)).toEqual(["bob", "carol"]);
    });

    it("a capture trigger's insert names the key alone, so a list filtered on another column is asked", async () => {
        const from = statements.length;
        service["cdcTableMap"] = new Map([["public.notes", registry.tableAt("notes")!]]);
        await service["handleCdcEvent"]({ schema: "public", table: "notes", op: "INSERT", row: { id: "9" } });
        jest.advanceTimersByTime(1500);
        await flush();
        expect(readersSince(from)).toEqual(["alice", "bob", "carol"]);
    });

    it("a capture trigger's key is enough for a list filtered on the key", async () => {
        // Only lists filtered on the key, so the key alone judges every one.
        await service.destroy();
        const recording = recordingDb();
        statements = recording.statements;
        service = new RealtimeService(recording.db, registry);
        service.setDataDriver(fakeCallContextDriver());
        await subscribe("k", { uid: "dave", roles: ["user"] }, { id: ["in", [1, 2]] });
        await subscribe("c", CAROL);
        await flush();
        jest.advanceTimersByTime(1500);
        await flush();
        service["cdcTableMap"] = new Map([["public.notes", registry.tableAt("notes")!]]);

        let from = statements.length;
        await service["handleCdcEvent"]({ schema: "public", table: "notes", op: "DELETE", row: { id: "9" } });
        jest.advanceTimersByTime(1500);
        await flush();
        // Dave's list holds ids 1 and 2: a delete of 9 cannot change it.
        expect(readersSince(from)).toEqual(["carol"]);

        from = statements.length;
        await service["handleCdcEvent"]({ schema: "public", table: "notes", op: "DELETE", row: { id: "2" } });
        jest.advanceTimersByTime(1500);
        await flush();
        expect(readersSince(from)).toEqual(["carol", "dave"]);
    });

    it("a change one indexed column cannot judge asks every list on the path", async () => {
        await subscribe("k", { uid: "dave", roles: ["user"] }, { id: ["in", [1, 2]] });
        await flush();
        jest.advanceTimersByTime(1500);
        await flush();
        const from = statements.length;
        service["cdcTableMap"] = new Map([["public.notes", registry.tableAt("notes")!]]);
        await service["handleCdcEvent"]({ schema: "public", table: "notes", op: "DELETE", row: { id: "9" } });
        jest.advanceTimersByTime(1500);
        await flush();
        expect(readersSince(from)).toEqual(["alice", "bob", "carol", "dave"]);
    });
});

describe("many subscribers, one write", () => {
    it("is one read for the one list the row belongs to, not one per subscriber", async () => {
        await service.destroy();
        const recording = recordingDb();
        statements = recording.statements;
        service = new RealtimeService(recording.db, registry);
        service.setDataDriver(fakeCallContextDriver());
        for (let i = 0; i < 500; i++) {
            const uid = `user${i}`;
            await subscribe(`c${i}`, { uid, roles: ["user"] }, { owner: ["==", uid] });
        }
        await flush();
        jest.advanceTimersByTime(1500);
        await flush();
        fetchCollectionForRest.mockClear();
        await service.notifyUpdate("notes", "1", { _rebase_invalidated: true }, undefined, true, "app", { before: null, after: { owner: "user7" } });
        jest.advanceTimersByTime(1500);
        await flush();
        expect(fetchCollectionForRest).toHaveBeenCalledTimes(1);
    });
});

describe("the judge's rules", () => {
    const table = () => {
        const reg = new FixtureTableRegistry();
        reg.registerMultiple([notes]);
        return reg.tableAt("notes")!;
    };

    it("reads values the way Postgres compares them", () => {
        expect(canonicalValue("integer", 7)).toBe("7");
        expect(canonicalValue("integer", " +007 ")).toBe("7");
        expect(canonicalValue("integer", 1.5)).toBeUndefined();
        expect(canonicalValue("boolean", "t")).toBe(canonicalValue("boolean", true));
        expect(canonicalValue("boolean", "maybe")).toBeUndefined();
        expect(canonicalValue("uuid", "{A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}"))
            .toBe(canonicalValue("uuid", "a0eebc999c0b4ef8bb6d6bb9bd380a11"));
        expect(canonicalValue("text", 5)).toBeUndefined();
        expect(canonicalValue("text", null)).toBe(NULL_KEY);
        expect(canonicalValue("jsonb", "x")).toBeUndefined();
    });

    it("judges only == and in on plain columns, and leaves every other condition out", () => {
        expect(compileListPrefilter(table(), { filter: { title: ["like", "a%"] } }, false)).toBeUndefined();
        expect(compileListPrefilter(table(), { filter: { "meta->>x": ["==", "a"] } }, false)).toBeUndefined();
        const both = compileListPrefilter(table(), { filter: { owner: ["==", "alice"], title: ["like", "a%"] } }, false);
        expect(both?.conjuncts.map(c => c.field)).toEqual(["owner"]);
    });

    it("never pre-filters a list that loads relations, or a table with an afterRead hook", () => {
        expect(compileListPrefilter(table(), { filter: { owner: ["==", "a"] }, include: ["author"] }, false)).toBeUndefined();
        expect(compileListPrefilter(table(), { filter: { owner: ["==", "a"] } }, true)).toBeUndefined();
    });

    it("reads == null and [in, null] as IS NULL, and a null inside a list as matching nothing", () => {
        const isNull = compileListPrefilter(table(), { filter: { owner: ["==", null] } }, false)!;
        expect(changeMayReach(isNull, { before: null, after: { owner: null } })).toBe(true);
        expect(changeMayReach(isNull, { before: null, after: { owner: "a" } })).toBe(false);
        const list = compileListPrefilter(table(), { filter: { owner: ["in", [null, "a"]] } }, false)!;
        expect(changeMayReach(list, { before: null, after: { owner: null } })).toBe(false);
        expect(changeMayReach(list, { before: null, after: { owner: "a" } })).toBe(true);
    });

    it("reads an unknown version as one that may match", () => {
        const owner = compileListPrefilter(table(), { filter: { owner: ["==", "a"] } }, false)!;
        expect(changeMayReach(owner, { after: { owner: "b" } })).toBe(true);
        expect(changeMayReach(owner, { before: { owner: "b" } })).toBe(true);
        expect(changeMayReach(owner, { before: { owner: "b" }, after: null })).toBe(false);
    });

    it("needs every judged condition to fail for at least one value, and none unknown", () => {
        const two = compileListPrefilter(table(), { filter: { owner: ["==", "a"], pinned: ["==", true] } }, false)!;
        expect(changeMayReach(two, { before: null, after: { owner: "a", pinned: false } })).toBe(false);
        expect(changeMayReach(two, { before: null, after: { owner: "a" } })).toBe(true);
        expect(changeMayReach(two, { before: null, after: { owner: "b" } })).toBe(false);
    });
});
