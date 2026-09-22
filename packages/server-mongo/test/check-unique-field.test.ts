/**
 * `checkUniqueField` on MongoDB is an equality test on one declared field.
 *
 * The socket's `CHECK_UNIQUE_FIELD` frame handed the client's `name` and
 * `value` to `countDocuments({ [name]: value })`. A value of
 * `{ $regex: "^123" }` made it a query-operator oracle — "unique" or not, over
 * a field of a row the caller's rules hide — and a name of `$expr` evaluated an
 * aggregation expression. Postgres compiles only `column = value` on a declared
 * column, so there the same frame could only ever ask about equality.
 */

import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db, ObjectId } from "mongodb";
import type { CollectionConfig, User } from "@rebasepro/types";
import { MongoDriver } from "../src/services/MongoDriver";
import { MongoDataService } from "../src/db/MongoDataService";
import { MongoCollectionRegistry } from "../src/factory";

const people: CollectionConfig = {
    slug: "people",
    name: "People",
    engine: "mongodb",
    properties: {
        email: { name: "Email", type: "string" },
        ssn: { name: "SSN", type: "string", access: { read: ["hr"], write: ["hr"] } },
        owner_id: { name: "Owner", type: "string" }
    },
    securityRules: [{ name: "own", operations: ["all"], ownerField: "owner_id" }]
};

const userWith = (uid: string, roles: string[]): User => ({
    uid, roles, displayName: null, email: null, photoURL: null, providerId: "test", isAnonymous: false
});

describe("MongoDB checkUniqueField", () => {
    let mongoServer: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;
    let driver: MongoDriver;
    let aliceId: string;

    beforeAll(async () => {
        mongoServer = await MongoMemoryServer.create();
        client = new MongoClient(mongoServer.getUri());
        await client.connect();
        db = client.db("test_unique_field");
        const registry = new MongoCollectionRegistry();
        registry.register(people);
        driver = new MongoDriver(db, undefined, undefined, registry);
        const inserted = await db.collection("people").insertOne({
            _id: new ObjectId(), email: "alice@example.com", ssn: "123-45-6789", owner_id: "alice"
        });
        aliceId = inserted.insertedId.toString();
    });

    afterAll(async () => {
        await client.close();
        await mongoServer.stop();
    });

    it("still answers the equality question it exists for", async () => {
        const scoped = await driver.withAuth(userWith("bob", []));
        expect(await scoped.checkUniqueField("people", "email", "alice@example.com")).toBe(false);
        expect(await scoped.checkUniqueField("people", "email", "bob@example.com")).toBe(true);
        // The row being edited does not collide with itself.
        expect(await scoped.checkUniqueField("people", "email", "alice@example.com", aliceId)).toBe(true);
        // An empty optional field is not "taken" by every row that lacks one.
        expect(await scoped.checkUniqueField("people", "email", null)).toBe(true);
    });

    it("refuses a query operator as the value", async () => {
        const scoped = await driver.withAuth(userWith("anonymous", ["anon"]));
        await expect(scoped.checkUniqueField("people", "email", { $regex: "^alice" }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(scoped.checkUniqueField("people", "email", { $ne: null }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it("refuses an operator, an undeclared field or an unreadable one as the name", async () => {
        const scoped = await driver.withAuth(userWith("anonymous", ["anon"]));
        await expect(scoped.checkUniqueField("people", "$expr", { $gt: [{ $strLenCP: "$ssn" }, 5] }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(scoped.checkUniqueField("people", "passwordHash", "x"))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(scoped.checkUniqueField("people", "ssn", "123-45-6789"))
            .rejects.toMatchObject({ statusCode: 400, code: "FIELD_NOT_READABLE" });
    });

    it("lets the role that may read a field ask about it", async () => {
        const scoped = await driver.withAuth(userWith("hannah", ["hr"]));
        expect(await scoped.checkUniqueField("people", "ssn", "123-45-6789")).toBe(false);
    });

    it("holds the same line in the repository, below any driver", async () => {
        const repository = new MongoDataService(db);
        await expect(repository.checkUniqueField("people", "ssn", { $regex: "^123" }))
            .rejects.toMatchObject({ statusCode: 400 });
        await expect(repository.checkUniqueField("people", "$where", "true"))
            .rejects.toMatchObject({ statusCode: 400 });
        expect(await repository.checkUniqueField("people", "email", "alice@example.com")).toBe(false);
    });
});
