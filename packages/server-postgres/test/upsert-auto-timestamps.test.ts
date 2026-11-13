import { pgTable, text } from "drizzle-orm/pg-core";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { recordingDb, shapedRows, type RecordedStatement } from "./helpers/spg-c-db";
import { DataService } from "../src/services/dataService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";

/**
 * A re-runnable import writes its rows with `status: "new"` plus `upsert` — the
 * right choice, because an import's rows carry a natural key for rows that may
 * not exist yet. But `status: "new"` also computes the `on_create` timestamp for
 * every row, and the conflict-update branch then wrote it over the value the
 * existing row already had. A nightly `POST /products/bulk {upsert: true}` reset
 * `createdAt` on every product it touched, and nothing in the response said so.
 */
describe("upsert and on_create timestamps", () => {
    const registry = new FixtureTableRegistry();

    const productsTable = pgTable("products", {
        sku: text("sku").primaryKey(),
        title: text("title"),
        createdAt: text("created_at"),
        updatedAt: text("updated_at")
    });

    const products: LegacyCollectionConfig = {
        slug: "products",
        name: "Products",
        table: "products",
        properties: {
            sku: { type: "string",
isId: true },
            title: { type: "string" },
            createdAt: { type: "date",
autoValue: "on_create" },
            updatedAt: { type: "date",
autoValue: "on_update" }
        }
    };

    let statements: RecordedStatement[];
    let dataService: DataService;

    /** The upsert drizzle sent, as the columns it inserts and the ones its conflict branch sets. */
    const upsertSent = () => {
        const statement = statements.find((s) => /^insert into "products"/i.test(s.text));
        if (!statement) throw new Error("no insert into products was sent");
        const valueOf = (placeholder: string) => statement.values[Number(placeholder) - 1];
        const [insertPart, conflictPart = ""] = statement.text.split(/ on conflict .*? do update set /i);
        const insertColumns = [...(/\(([^)]*)\) values/i.exec(insertPart)?.[1] ?? "").matchAll(/"(\w+)"/g)].map((m) => m[1]);
        const insertValues = [...(/values \(([^)]*)\)/i.exec(insertPart)?.[1] ?? "").matchAll(/\$(\d+)/g)].map((m) => valueOf(m[1]));
        const inserted = Object.fromEntries(insertColumns.map((column, i) => [column, insertValues[i]]));
        const set = Object.fromEntries(
            [...conflictPart.replace(/ returning .*$/is, "").matchAll(/"(\w+)" = \$(\d+)/g)].map((m) => [m[1], valueOf(m[2])])
        );
        return { inserted, set };
    };

    beforeEach(() => {
        jest.spyOn(registry, "getCollectionByPath").mockReturnValue(products);
        jest.spyOn(registry, "getCollections").mockReturnValue([products]);
        jest.spyOn(registry, "getPgTable").mockReturnValue(productsTable);

        // Reads find the product; the upsert answers with its key.
        const recording = recordingDb((statement) => shapedRows(statement, [{ sku: "SKU-1", title: "Widget" }]));
        statements = recording.statements;
        const db = recording.db;

        dataService = new DataService(db, registry);
    });

    afterEach(() => jest.restoreAllMocks());

    const upsert = () => dataService.save(
        "products",
        {
            sku: "SKU-1",
            title: "Widget",
            createdAt: "2026-08-08T10:00:00.000Z",
            updatedAt: "2026-08-08T10:00:00.000Z"
        },
        "SKU-1",
        undefined,
        { upsert: true }
    );

    it("does not re-stamp createdAt on a row that already existed", async () => {
        await upsert();
        const { set } = upsertSent();
        expect(set).not.toHaveProperty("created_at");
    });

    it("still updates the on_update stamp and the ordinary columns", async () => {
        await upsert();
        const { set } = upsertSent();
        expect(set.updated_at).toBe("2026-08-08T10:00:00.000Z");
        expect(set.title).toBe("Widget");
    });

    it("still writes createdAt in the INSERT branch, where the row is new", async () => {
        await upsert();
        const { inserted } = upsertSent();
        expect(inserted.created_at).toBe("2026-08-08T10:00:00.000Z");
    });

    it("never reassigns the key column against the conflict target", async () => {
        await upsert();
        const { set } = upsertSent();
        expect(set).not.toHaveProperty("sku");
    });
});
