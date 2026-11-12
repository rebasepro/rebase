import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig, ResolvedVia } from "@rebasepro/types";
import { RelationWriteService } from "../src/services/RelationWriteService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { FixtureTableRegistry } from "./helpers/tables";
import { recordingDb } from "./helpers/spg-b-recording-db";

/**
 * Which parent column a one-to-one `via` write copies into the target.
 *
 * The mapping walked back along the path reading each step's table out of a
 * `table.column` spelling alone. A step written the way `JoinStep` documents —
 * bare columns, `from` on the previous table — named no table, matched no
 * step, and every write through it was refused with "Could not resolve parent
 * source column". Same bug as the count and include builders, on the write
 * side.
 */

const products: CollectionConfig = { slug: "products", name: "Products", table: "products", properties: {} };
const service = new RelationWriteService(recordingDb().db, new FixtureTableRegistry());

function via(joinPath: ResolvedVia["joinPath"]): ResolvedVia {
    return {
        kind: "via",
        relationName: "detail",
        target: () => products,
        cardinality: "one",
        targetSlug: "products",
        writable: true,
        shared: false,
        joinPath
    };
}

describe("resolveJoinPathWriteMapping", () => {

    it("reads a documented single step: from on the parent, to on the target", () => {
        expect(service.resolveJoinPathWriteMapping(products, via([
            { table: "product_details", on: { from: "id", to: "product_id" } }
        ]))).toEqual({ targetFKColName: "product_id", parentSourceColName: "id" });
    });

    it("walks a documented path back to its first step, by position", () => {
        expect(service.resolveJoinPathWriteMapping(products, via([
            { table: "order_items", on: { from: "sku", to: "product_sku" } },
            { table: "orders", on: { from: "order_id", to: "id" } }
        ]))).toEqual({ targetFKColName: "id", parentSourceColName: "sku" });
    });

    it("still follows a table.column spelling", () => {
        expect(service.resolveJoinPathWriteMapping(products, via([
            { table: "product_details", on: { from: "products.id", to: "product_details.product_id" } }
        ]))).toEqual({ targetFKColName: "product_id", parentSourceColName: "id" });
    });
});
