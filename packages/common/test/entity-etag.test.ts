/**
 * A row's version crosses the admin boundary.
 *
 * The SDK keeps the `ETag` a read reported on the row, out of sight
 * (`withETag`). The admin works on `Entity` view models built from those rows,
 * and building one dropped the tag, so a form had no version to save against
 * and `update` had no way to send one. The entity now carries it as `etag`,
 * and `update(id, data, { ifMatch })` hands it to the SDK.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { Entity, RebaseSdkData } from "@rebasepro/types";
import { wrapAsEntityData } from "../src/data/buildRebaseData";
import { withETag } from "../src/data/row-etag";

type Row = Record<string, unknown>;

function sdkWith(collection: Record<string, unknown>): Pick<RebaseSdkData, "collection"> {
    return { collection: () => collection } as unknown as Pick<RebaseSdkData, "collection">;
}

describe("an entity carries the version of the row it was built from", () => {
    it("from a read by id, a live row frame and an update", async () => {
        const update = jest.fn(async (_id: string | number, data: Row, _options?: { ifMatch?: string }) =>
            withETag({ id: "1", ...data }, "\"v2\""));
        let frame: ((row: Row | undefined) => void) | undefined;
        const data = wrapAsEntityData(sdkWith({
            findById: async () => withETag({ id: "1", title: "a" }, "\"v1\""),
            update,
            listenById: (_id: string, onUpdate: (row: Row | undefined) => void) => {
                frame = onUpdate;
                return () => undefined;
            }
        }));
        const posts = data.collection("posts");

        const read = await posts.findById("1");
        expect(read?.etag).toBe("\"v1\"");
        // A sibling of `values`, never one of them.
        expect(read?.values).toEqual({ id: "1", title: "a" });

        const live: (Entity | undefined)[] = [];
        posts.listenById!("1", (entity) => live.push(entity));
        frame!(withETag({ id: "1", title: "b" }, "\"v3\""));
        expect(live[0]?.etag).toBe("\"v3\"");

        const saved = await posts.update("1", { title: "c" }, { ifMatch: "\"v1\"" });
        expect(update).toHaveBeenCalledWith("1", { title: "c" }, { ifMatch: "\"v1\"" });
        expect(saved.etag).toBe("\"v2\"");
    });

    it("a row with no version builds an entity with no `etag` key, and updates without options", async () => {
        const update = jest.fn(async (_id: string | number, data: Row) => ({ id: "1", ...data }));
        const data = wrapAsEntityData(sdkWith({ findById: async () => ({ id: "1", title: "a" }), update }));
        const posts = data.collection("posts");

        expect(await posts.findById("1")).toEqual({ id: "1", path: "posts", values: { id: "1", title: "a" } });
        await posts.update("1", { title: "c" });
        expect(update.mock.calls[0]).toEqual(["1", { title: "c" }]);
    });
});
