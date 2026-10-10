/**
 * A live list keeps an unchanged row's object across frames.
 *
 * The socket client already does (`mergeRows` hands back the cached row when
 * the server's refetch of it is equal), and the admin's views compare rows by
 * reference before they compare them by value. The admin boundary used to undo
 * that: it built a new `Entity` for every row of every frame, so a push that
 * changed one row of fifty handed every consumer fifty new objects.
 */
import { describe, expect, it } from "@jest/globals";
import type { Entity, FindResult, RebaseSdkData } from "@rebasepro/types";
import { wrapAsEntityData } from "../src/data/buildRebaseData";

type Row = Record<string, unknown>;

function liveSdk() {
    let deliver: ((rows: Row[]) => void) | undefined;
    const sdk = {
        collection: () => ({
            listen: (_params: unknown, onUpdate: (result: FindResult<Row>) => void) => {
                deliver = (rows) => onUpdate({ data: rows, meta: { total: rows.length, limit: 50, offset: 0, hasMore: false } });
                return () => {
                    deliver = undefined;
                };
            }
        })
    } as unknown as Pick<RebaseSdkData, "collection">;
    return { sdk, push: (rows: Row[]) => deliver!(rows) };
}

const products = {
    slug: "products",
    properties: { id: { type: "string", isId: true }, name: { type: "string" } }
};

describe("a live list through the admin boundary", () => {

    it("keeps the entity of a row the socket kept, and builds one for a row that changed", () => {
        const { sdk, push } = liveSdk();
        const data = wrapAsEntityData(sdk, { resolveCollection: () => products as never });
        const frames: Entity[][] = [];
        const stop = data.collection("products").listen!({}, (result) => frames.push(result.data));

        const a = { id: "a", name: "A" };
        const b = { id: "b", name: "B" };
        push([a, b]);
        // `mergeRows` hands back `a` itself; `b` was edited.
        push([a, { id: "b", name: "B, renamed" }]);

        expect(frames[1][0]).toBe(frames[0][0]);
        expect(frames[1][1]).not.toBe(frames[0][1]);
        expect(frames[1][1].values.name).toBe("B, renamed");
        stop();
    });

    it("builds the entities again when the collection it converts with is replaced", () => {
        const { sdk, push } = liveSdk();
        let collection: typeof products | undefined;
        const data = wrapAsEntityData(sdk, { resolveCollection: () => collection as never });
        const frames: Entity[][] = [];
        data.collection("products").listen!({}, (result) => frames.push(result.data));

        const a = { id: "a", name: "A" };
        push([a]);
        // The registry had not resolved the collection yet; now it has.
        collection = products;
        push([a]);
        collection = { ...products, properties: { ...products.properties } };
        push([a]);

        expect(frames[1][0]).not.toBe(frames[0][0]);
        expect(frames[2][0]).not.toBe(frames[1][0]);
        expect(frames[2][0].id).toBe("a");
    });
});
