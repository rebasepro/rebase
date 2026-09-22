/**
 * Per-field `access` on the MongoDB driver.
 *
 * `securityRules` decide which rows a caller reaches; `property.access` (and
 * `excludeFromApi`, its `read: [], write: []` shorthand) decides which fields of
 * those rows they see. Postgres strips the withheld fields from every row its
 * pipeline serves. This driver served them whole — REST, socket reads and
 * subscriptions alike — so an anonymous caller received `salary` and `apiToken`
 * on every row, and could find a withheld value by searching or filtering on it.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import type { CollectionConfig, User } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import { MongoCollectionRegistry } from "../src/factory";

const staff: CollectionConfig = {
    slug: "staff",
    name: "Staff",
    engine: "mongodb",
    properties: {
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"], write: ["hr"] } },
        apiToken: { name: "API token", type: "string", excludeFromApi: true }
    }
};

const userWith = (uid: string, roles: string[]): User => ({
    uid,
    roles,
    displayName: null,
    email: null,
    photoURL: null,
    providerId: "test",
    isAnonymous: false
});

const anon = userWith("anonymous", ["anon"]);
const hr = userWith("hannah", ["hr"]);
const admin = userWith("root", ["admin"]);

const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
    }
};

describe("MongoDB per-field access", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let realtimeService: MongoRealtimeService;
    let driver: MongoDriver;
    let rowId: string;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_field_access");
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    beforeEach(async () => {
        for (const col of await db.listCollections().toArray()) {
            await db.dropCollection(col.name);
        }
        const registry = new MongoCollectionRegistry();
        registry.register(staff);
        realtimeService = new MongoRealtimeService(db);
        driver = new MongoDriver(db, realtimeService, undefined, registry);

        const inserted = await db.collection("staff").insertOne({
            _id: new ObjectId(), name: "Dana", salary: 120000, apiToken: "tok_live_secret"
        });
        rowId = inserted.insertedId.toString();
    });

    afterEach(async () => {
        await realtimeService.closeAll();
    });

    it("withholds a role-gated and an excluded field from a list", async () => {
        const rows = await (await driver.withAuth(anon)).fetchCollection({ path: "staff", collection: staff });
        expect(rows).toEqual([{ id: rowId, name: "Dana" }]);
    });

    it("withholds them from a single-row read", async () => {
        const row = await (await driver.withAuth(anon)).fetchOne({ path: "staff", id: rowId, collection: staff });
        expect(row).toEqual({ id: rowId, name: "Dana" });
    });

    it("serves a role-gated field to the role it names, and to admin — but an excluded one to nobody", async () => {
        for (const reader of [hr, admin]) {
            const row = await (await driver.withAuth(reader)).fetchOne({ path: "staff", id: rowId, collection: staff });
            expect(row).toEqual({ id: rowId, name: "Dana", salary: 120000 });
        }
    });

    it("withholds them from the row a save returns", async () => {
        const saved = await (await driver.withAuth(hr)).save({
            path: "staff", id: rowId, values: { name: "Dana R." }, collection: staff, status: "existing"
        });
        expect(saved).toEqual({ id: rowId, name: "Dana R.", salary: 120000 });
    });

    it("withholds them from what a subscription is pushed", async () => {
        const scoped = await driver.withAuth(anon);
        if (!scoped.listenCollection || !scoped.listenOne) throw new Error("withAuth() returned a driver that cannot listen");
        const lists: Record<string, unknown>[][] = [];
        const singles: (Record<string, unknown> | null)[] = [];
        const stopList = scoped.listenCollection({ path: "staff", collection: staff, onUpdate: rows => lists.push(rows) });
        const stopOne = scoped.listenOne({ path: "staff", id: rowId, collection: staff, onUpdate: row => singles.push(row) });
        await settle();
        stopList();
        stopOne();

        expect(lists[0]).toEqual([{ id: rowId, name: "Dana" }]);
        expect(singles[0]).toEqual({ id: rowId, name: "Dana" });
    });

    it("does not let a search find a row by a field the caller cannot read", async () => {
        const rows = await (await driver.withAuth(anon)).fetchCollection({
            path: "staff", collection: staff, searchString: "tok_live"
        });
        expect(rows).toEqual([]);
    });

    it("refuses a filter or a sort on a field the caller cannot read", async () => {
        const scoped = await driver.withAuth(anon);
        await expect(scoped.fetchCollection({ path: "staff", collection: staff, filter: { salary: [">", 100000] } }))
            .rejects.toMatchObject({ statusCode: 400, code: "FIELD_NOT_READABLE" });
        await expect(scoped.fetchCollection({
            path: "staff",
            collection: staff,
            logical: { type: "or", conditions: [{ column: "apiToken", operator: "==", value: "tok_live_secret" }] }
        })).rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
        await expect(scoped.fetchCollection({ path: "staff", collection: staff, orderBy: "salary" }))
            .rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
        await expect(scoped.count!({ path: "staff", collection: staff, filter: { salary: [">", 100000] } }))
            .rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
    });

    it("still lets the role that may read a field filter on it", async () => {
        const rows = await (await driver.withAuth(hr)).fetchCollection({
            path: "staff", collection: staff, filter: { salary: [">", 100000] }
        });
        expect(rows.map(r => r.name)).toEqual(["Dana"]);
    });
});
