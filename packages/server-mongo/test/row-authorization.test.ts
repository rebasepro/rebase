/**
 * Row authorization on the MongoDB driver.
 *
 * MongoDB has no RLS, so `securityRules` are enforced in-process by
 * `AuthenticatedMongoDriver`. Every test here asserts the *single-row* paths —
 * `fetchOne`, `save`, `delete` — because those were the ones returning `true`
 * by construction: `checkOperation` discarded the rules for any collection whose
 * engine reported `supportsRLS: false`, so the listing filtered correctly while
 * the same rows were handed to anyone who asked for them by id.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import { CollectionConfig, User } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoCollectionRegistry } from "../src/factory";
import { SECURITY_RULE_UNSUPPORTED } from "../src/db/securityRuleFilter";

const alice = { uid: "alice",
roles: [] } as unknown as User;
const bob = { uid: "bob",
roles: [] } as unknown as User;

/** Owner-scoped, the shape `docs/data-sources.md` tells a developer to write. */
const notes: CollectionConfig = {
    slug: "notes",
    // Deliberately different from the slug: the registry used to key on this.
    name: "Notes (MongoDB)",
    engine: "mongodb",
    properties: {
        title: { name: "Title",
type: "string" },
        status: { name: "Status",
type: "string" },
        owner_id: { name: "Owner",
type: "string" }
    },
    securityRules: [
        { name: "own_notes",
operations: ["all"],
ownerField: "owner_id" }
    ]
};

describe("MongoDB row authorization", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let driver: MongoDriver;
    let aliceNoteId: string;
    let bobNoteId: string;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_row_auth");
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    /**
     * A driver whose registry holds exactly `collection`. The registry is
     * authoritative — `resolveCollectionCallbacks` merges it *over* whatever the
     * caller passed — so a variant rule set has to be registered, not just
     * handed in.
     */
    const driverWith = (collection: CollectionConfig): MongoDriver => {
        const registry = new MongoCollectionRegistry();
        registry.register(collection);
        return new MongoDriver(db, undefined, undefined, registry);
    };

    beforeEach(async () => {
        for (const col of await db.listCollections().toArray()) {
            await db.dropCollection(col.name);
        }
        driver = driverWith(notes);

        const inserted = await db.collection("notes").insertMany([
            { _id: new ObjectId(), title: "Alice's", status: "draft", owner_id: "alice" },
            { _id: new ObjectId(), title: "Bob's", status: "draft", owner_id: "bob" }
        ]);
        aliceNoteId = inserted.insertedIds[0].toString();
        bobNoteId = inserted.insertedIds[1].toString();
    });

    describe("the single-row paths enforce what the listing filters", () => {
        it("lists only the caller's own rows", async () => {
            const scoped = await driver.withAuth(alice);
            const rows = await scoped.fetchCollection({ path: "notes", collection: notes });
            expect(rows.map(r => r.title)).toEqual(["Alice's"]);
        });

        it("refuses to hand a row to a user the rule excludes", async () => {
            const scoped = await driver.withAuth(bob);
            const stolen = await scoped.fetchOne({ path: "notes",
id: aliceNoteId,
collection: notes });
            expect(stolen).toBeUndefined();
        });

        it("still returns the row to its owner — the rule must discriminate", async () => {
            const scoped = await driver.withAuth(alice);
            const own = await scoped.fetchOne({ path: "notes",
id: aliceNoteId,
collection: notes });
            expect(own?.title).toBe("Alice's");
        });

        it("refuses an update to someone else's row, and writes nothing", async () => {
            const scoped = await driver.withAuth(bob);
            await expect(scoped.save({
                path: "notes",
                id: aliceNoteId,
                values: { title: "Taken" },
                collection: notes,
                status: "existing"
            })).rejects.toThrow(/Forbidden/);

            const stored = await db.collection("notes").findOne({ _id: new ObjectId(aliceNoteId) });
            expect(stored?.title).toBe("Alice's");
        });

        it("refuses a delete of someone else's row", async () => {
            const scoped = await driver.withAuth(bob);
            await expect(scoped.delete({
                row: { id: aliceNoteId, path: "notes" },
                collection: notes
            })).rejects.toThrow(/Forbidden/);

            expect(await db.collection("notes").countDocuments()).toBe(2);
        });

        it("refuses an insert that would not satisfy the rule", async () => {
            const scoped = await driver.withAuth(bob);
            await expect(scoped.save({
                path: "notes",
                values: { title: "Planted", owner_id: "alice" },
                collection: notes,
                status: "new"
            })).rejects.toThrow(/Forbidden/);

            expect(await db.collection("notes").countDocuments()).toBe(2);
        });
    });

    describe("WITH CHECK runs before the write, not after it", () => {
        /**
         * There is no transaction here: a check that runs after `delegate.save`
         * cannot undo the document, the history entry or the realtime push. The
         * caller used to get a 403 for a mutation that had already landed.
         */
        it("does not commit an update whose new values fail the rule", async () => {
            const scoped = await driver.withAuth(bob);
            await expect(scoped.save({
                path: "notes",
                id: bobNoteId,
                // Handing his own row to Alice: USING passes on the stored row,
                // WITH CHECK fails on the row that would replace it.
                values: { owner_id: "alice" },
                collection: notes,
                status: "existing"
            })).rejects.toThrow(/Forbidden/);

            const stored = await db.collection("notes").findOne({ _id: new ObjectId(bobNoteId) });
            expect(stored?.owner_id).toBe("bob");
        });

        it("allows an update that keeps satisfying the rule", async () => {
            const scoped = await driver.withAuth(bob);
            const saved = await scoped.save({
                path: "notes",
                id: bobNoteId,
                values: { title: "Renamed" },
                collection: notes,
                status: "existing"
            });
            expect(saved.title).toBe("Renamed");
        });
    });

    describe("a rule this driver cannot translate", () => {
        const tenanted: CollectionConfig = {
            ...notes,
            securityRules: [
                { name: "tenant",
operations: ["all"],
using: "tenant_id = current_setting('app.tenant')" }
            ]
        };

        /**
         * The translator used to return `{}` — "match every document" — for any
         * expression outside four recognised shapes, and an always-true
         * permissive rule then removed all narrowing. Refusing is the only
         * honest answer: the request cannot be authorized, so it is not served.
         */
        it("refuses the listing instead of returning every row", async () => {
            const scoped = await driverWith(tenanted).withAuth(bob);
            await expect(scoped.fetchCollection({ path: "notes",
collection: tenanted }))
                .rejects.toMatchObject({ code: SECURITY_RULE_UNSUPPORTED });
        });

        it("refuses a count for the same reason", async () => {
            const scoped = await driverWith(tenanted).withAuth(bob);
            await expect(scoped.count!({ path: "notes",
collection: tenanted }))
                .rejects.toMatchObject({ code: SECURITY_RULE_UNSUPPORTED });
        });

        it("refuses a single-row read with the same, nameable error", async () => {
            const scoped = await driverWith(tenanted).withAuth(bob);
            await expect(scoped.fetchOne({ path: "notes",
id: aliceNoteId,
collection: tenanted }))
                .rejects.toMatchObject({ code: SECURITY_RULE_UNSUPPORTED });
        });

        it("names the collection and the expression, so the message is actionable", async () => {
            const scoped = await driverWith(tenanted).withAuth(bob);
            await expect(scoped.fetchCollection({ path: "notes",
collection: tenanted }))
                .rejects.toThrow(/notes.*current_setting\('app\.tenant'\)/s);
        });
    });

    describe("clause semantics", () => {
        /**
         * `withCheck` constrains writes. ANDing it into a `select` narrows reads
         * by a predicate that was never meant to gate them.
         */
        it("does not apply `withCheck` as a read filter", async () => {
            const draftsOnlyOnWrite: CollectionConfig = {
                ...notes,
                securityRules: [
                    { name: "own_write_drafts",
operations: ["all"],
using: "owner_id = rebase.uid()",
withCheck: "status = 'published'" }
                ]
            };
            const scoped = await driverWith(draftsOnlyOnWrite).withAuth(alice);
            const rows = await scoped.fetchCollection({ path: "notes",
collection: draftsOnlyOnWrite });
            expect(rows.map(r => r.title)).toEqual(["Alice's"]);
        });

        it("denies when no rule covers the operation at all", async () => {
            const selectOnly: CollectionConfig = {
                ...notes,
                securityRules: [{ name: "read_own",
operations: ["select"],
ownerField: "owner_id" }]
            };
            const scoped = await driverWith(selectOnly).withAuth(alice);
            await expect(scoped.save({
                path: "notes",
                id: aliceNoteId,
                values: { title: "Nope" },
                collection: selectOnly,
                status: "existing"
            })).rejects.toThrow(/Forbidden/);
        });
    });

    describe("the authenticated path keeps the query it was given", () => {
        /**
         * The wrapper rebuilt the query by hand from three fields and passed the
         * result as `rawQuery`, which the repository prefers over anything it
         * could rebuild — so `logical` travelled in the props spread and was
         * never consulted. A dropped `or(...)` does not fail, it widens.
         */
        it("narrows by a logical group, and counts the same rows", async () => {
            await db.collection("notes").insertOne({ title: "Alice's second",
status: "published",
owner_id: "alice" });
            const scoped = await driver.withAuth(alice);
            const logical = {
                type: "or" as const,
                conditions: [
                    { column: "title", operator: "==" as const, value: "Alice's" },
                    { column: "title", operator: "==" as const, value: "Nobody's" }
                ]
            };

            const rows = await scoped.fetchCollection({ path: "notes",
collection: notes,
logical });
            expect(rows.map(r => r.title)).toEqual(["Alice's"]);
            expect(await scoped.count!({ path: "notes",
collection: notes,
logical })).toBe(1);
        });
    });
});
