/**
 * `databaseDefault` given as SQL is a DEFAULT the planner writes.
 *
 * `databaseDefault: true` declares that the database fills a column on create
 * and leaves the DEFAULT itself to whoever made it, so `rebase db push` planned
 * dropping it. Given the expression — `` databaseDefault: "sql`gen_random_uuid()`" ``,
 * the template form `isId` takes — the planner writes it back: in `schema.sql`,
 * in the Drizzle table, and as `SET DEFAULT` on a column that has none.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import { diffPlanAgainstCatalogue } from "../src/schema/plan/diff-plan";

const coupons = (databaseDefault: true | `sql\`${string}\``): CollectionConfig => ({
    name: "Coupons",
    slug: "coupons",
    table: "coupons",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        code: { name: "Code", type: "string", validation: { required: true }, databaseDefault },
        label: { name: "Label", type: "string" }
    }
});

let db: PGlite | undefined;

afterEach(async () => {
    await db?.close();
    db = undefined;
});

const codeColumn = (collection: CollectionConfig) =>
    planSchema([collection]).tables.find((t) => t.table === "coupons")?.columns.find((c) => c.column === "code");

describe("databaseDefault as SQL", () => {
    it("is the column's DEFAULT, with the template wrapper stripped", () => {
        expect(codeColumn(coupons("sql`upper(md5(random()::text))`"))?.default)
            .toEqual({ kind: "sql", expression: "upper(md5(random()::text))" });
    });

    it("applies: a create that leaves the column out gets a value from the database", async () => {
        const ddl = renderPostgresDdl(planSchema([coupons("sql`upper(md5(random()::text))`")]), { includePolicies: false });
        expect(ddl).toContain("DEFAULT upper(md5(random()::text))");
        db = new PGlite();
        await db.waitReady;
        await db.exec(ddl);
        await db.query("INSERT INTO coupons (label) VALUES ('spring')");
        const { rows } = await db.query<{ code: string }>("SELECT code FROM coupons");
        expect(rows[0].code).toMatch(/^[0-9A-F]{32}$/);
    });

    it("reaches the Drizzle table as sql`…`", () => {
        const drizzle = renderDrizzleSchema(planSchema([coupons("sql`upper(md5(random()::text))`")]));
        expect(drizzle).toContain(".default(sql`upper(md5(random()::text))`)");
    });

    it("is set on a live column that has no DEFAULT, instead of dropped", () => {
        const plan = planSchema([coupons("sql`upper(md5(random()::text))`")]);
        const changes = diffPlanAgainstCatalogue(plan, {
            tables: new Map([["public.coupons", new Set(["id", "code", "label"])]]),
            enums: new Set(),
            columnDefaults: new Set(["public.coupons.id"])
        });
        expect(changes.statements).toContain(
            "ALTER TABLE \"public\".\"coupons\" ALTER COLUMN \"code\" SET DEFAULT upper(md5(random()::text));"
        );
    });

    it("databaseDefault: true still writes no DEFAULT", () => {
        expect(codeColumn(coupons(true))?.default).toBeUndefined();
    });
});
