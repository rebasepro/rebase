/**
 * A `belongsTo` written by its relation name is a write of its key column, and
 * the driver judges it as one (SEC-FIX-3 D-1): the create stamps an update
 * drops, the user stamp a create sets, the key an update may not move — on a
 * real Postgres (PGlite), through the driver every door reaches, and the
 * in-process SDK, whose link spelling does exactly what its column spelling
 * does.
 *
 * Before: `PATCH { creator: victim }` reattributed a row whose `createdBy` an
 * update cannot touch, because the stamps judged the column's name only and
 * the serializer then mapped the link onto the column.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, rel } from "@rebasepro/types";
import { buildSdkData, compileSchema } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const people = defineTable("people", {
    columns: { id: col.text().primaryKey(), name: col.text() },
    rls: "admin-only"
});
const docs = defineTable("docs", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        title: col.text(),
        createdBy: col.text().onCreateUser(),
        reviewerId: col.text().readOnly(),
        approverId: col.text().access({ write: ["admin"] }),
        informantId: col.text().private()
    },
    relations: {
        creator: rel.belongsTo(() => people, { localKey: "created_by" }),
        reviewer: rel.belongsTo(() => people, { localKey: "reviewer_id" }),
        approver: rel.belongsTo(() => people, { localKey: "approver_id" }),
        informant: rel.belongsTo(() => people, { localKey: "informant_id" })
    },
    rls: "admin-only"
});
const profiles = defineTable("profiles", {
    columns: { userId: col.text().primaryKey(), bio: col.text() },
    relations: { user: rel.belongsTo(() => people, { localKey: "user_id" }) },
    rls: "admin-only"
});

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let driver: PostgresBackendDriver;
let registry: PostgresTableRegistry;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const compiled = compileSchema([people, docs, profiles]);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    registry = new PostgresTableRegistry();
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
    await db.exec(`
        INSERT INTO people (id, name) VALUES ('author', 'A'), ('victim', 'V'), ('u1', 'U1'), ('u2', 'U2');
        INSERT INTO docs (title, created_by) VALUES ('d1', 'author');
        INSERT INTO profiles (user_id, bio) VALUES ('u1', 'hello');
    `);
});

afterAll(async () => {
    await db.close();
});

const stored = async (sql: string) => (await db.query<Record<string, unknown>>(sql)).rows;

function refusal(error: unknown): { code?: string; message: string } {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    return { code, message: error instanceof Error ? error.message : String(error) };
}

describe("a link written by name is its key column to the driver", () => {
    it("an update drops a create stamp by either spelling — the row is not reattributed", async () => {
        await driver.save({ path: "docs", id: 1, values: { creator: "victim" }, status: "existing" });
        await driver.save({ path: "docs", id: 1, values: { createdBy: "victim" }, status: "existing" });
        expect(await stored("SELECT created_by FROM docs WHERE id = 1")).toEqual([{ created_by: "author" }]);
    });

    it("a create stamps the acting user over either spelling (none here: the trusted plane stores null)", async () => {
        const viaLink = await driver.save({ path: "docs", values: { title: "d2", creator: "victim" }, status: "new" });
        const viaColumn = await driver.save({ path: "docs", values: { title: "d3", createdBy: "victim" }, status: "new" });
        expect(await stored(`SELECT created_by FROM docs WHERE id IN (${Number(viaLink.id)}, ${Number(viaColumn.id)})`))
            .toEqual([{ created_by: null }, { created_by: null }]);
    });

    it("an update cannot move a key bound to a link, by either spelling", async () => {
        const spellings: Record<string, unknown>[] = [{ user: "u2" }, { userId: "u2" }];
        for (const values of spellings) {
            let caught: unknown;
            try {
                await driver.save({ path: "profiles", id: "u1", values, status: "existing" });
            } catch (error) {
                caught = error;
            }
            expect(refusal(caught).code).toBe("KEY_IMMUTABLE");
        }
        expect(await stored("SELECT user_id FROM profiles")).toEqual([{ user_id: "u1" }]);
    });

    it("refuses both spellings with different keys, and takes them when they agree", async () => {
        let caught: unknown;
        try {
            await driver.save({ path: "docs", id: 1, values: { reviewer: "u1", reviewerId: "u2" }, status: "existing" });
        } catch (error) {
            caught = error;
        }
        expect(refusal(caught)).toMatchObject({ code: "VALIDATION_INVALID_VALUE", message: expect.stringContaining("set the same column") });
        await driver.save({ path: "docs", id: 1, values: { reviewer: "u1", reviewerId: "u1" }, status: "existing" });
        expect(await stored("SELECT reviewer_id FROM docs WHERE id = 1")).toEqual([{ reviewer_id: "u1" }]);
    });

    it("still refuses a link written as an object, naming the relation", async () => {
        let caught: unknown;
        try {
            await driver.save({ path: "docs", id: 1, values: { reviewer: { id: "u2" } }, status: "existing" });
        } catch (error) {
            caught = error;
        }
        expect(refusal(caught)).toMatchObject({ code: "VALIDATION_INVALID_VALUE", message: expect.stringContaining("'docs.reviewer'") });
    });
});

/**
 * The in-process door, per rule, so it cannot drift (SEC-FIX-3, aligned with
 * `main`): the API boundary's column rules — `.readOnly()`, `access.write`,
 * `.private()` — are not the in-process SDK's (it is the project's own server
 * code, on `main` as before this change); the identity rules — the create
 * stamps, key immutability (above), the tenant (e2e) — are the driver's, on
 * every door. Whatever a rule does to the column's own name, it does to the
 * link's.
 */
describe("the in-process SDK: a link name ≡ its key column, rule by rule", () => {
    const sdk = () => buildSdkData(driver).table("docs");
    const column = async (sql: string) => (await stored(`SELECT ${sql} AS value FROM docs WHERE id = 1`))[0]?.value;

    it.each([
        [".readOnly()", "reviewerId", "reviewer", "reviewer_id"],
        ["access.write", "approverId", "approver", "approver_id"],
        [".private()", "informantId", "informant", "informant_id"]
    ])("%s is an API-boundary rule: both spellings write in process, alike", async (_rule, key, link, sql) => {
        await sdk().update(1, { [key]: "u1" });
        expect(await column(sql)).toBe("u1");
        await sdk().update(1, { [link]: "u2" });
        expect(await column(sql)).toBe("u2");
    });

    it("an `.onCreateUser()` stamp is an identity rule: an update drops both spellings", async () => {
        await sdk().update(1, { createdBy: "victim" });
        await sdk().update(1, { creator: "victim" });
        expect(await column("created_by")).toBe("author");
    });
});
