import { describe, expect, it } from "@jest/globals";
import { col, defineTable, json, rel } from "@rebasepro/types";
import type { ColumnDescriptor, TableDescriptor } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { restCodecOf, valueCodecOf, valueCodecOfType } from "../src/table/codecs";

/**
 * The codec family of a column comes from its Postgres type: the one question
 * the REST row, the write serialisation and the admin view model each ask.
 */

const authors = defineTable("authors", {
    columns: { id: col.bigint().primaryKey() },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text(),
        code: col.varchar(12),
        status: col.enum(["draft", "published"]),
        views: col.integer(),
        hits: col.bigint(),
        price: col.numeric(10, 2),
        ratio: col.doublePrecision(),
        published: col.boolean(),
        createdAt: col.timestamptz(),
        day: col.date(),
        opensAt: col.time(),
        meta: col.jsonb(json.object({ seo: json.string() })),
        raw: col.json(),
        place: col.geopoint(),
        embedding: col.vector(3),
        file: col.bytea(),
        tags: col.array(col.text()),
        ip: col.custom("inet")
    },
    relations: { author: rel.belongsTo(() => authors) },
    rls: "admin-only"
});

const [postsTable] = compileTables([posts, authors]);

function table(): TableDescriptor {
    if (!postsTable) throw new Error("posts did not compile");
    return postsTable;
}

function column(key: string): ColumnDescriptor {
    const found = table().columns.find(candidate => candidate.key === key);
    if (!found) throw new Error(`posts has no column ${key}`);
    return found;
}

describe("valueCodecOf", () => {
    it.each([
        ["id", "text"], ["title", "text"], ["code", "text"], ["status", "text"],
        ["views", "number"], ["hits", "number"], ["price", "number"], ["ratio", "number"],
        ["published", "boolean"],
        ["createdAt", "timestamp"], ["day", "date"], ["opensAt", "time"],
        ["meta", "json"], ["raw", "json"], ["place", "geopoint"],
        ["embedding", "vector"], ["file", "bytea"], ["tags", "array"], ["ip", "passthrough"]
    ])("%s is %s", (key, codec) => {
        expect(valueCodecOf(column(key))).toBe(codec);
    });

    it("gives a native array's items the codec of their own type", () => {
        const type = column("tags").type;
        expect(type.kind === "array" ? valueCodecOfType(type.of) : undefined).toBe("text");
        expect(valueCodecOfType({ kind: "array", of: { kind: "numeric" } })).toBe("array");
        expect(valueCodecOfType({ kind: "numeric" })).toBe("number");
    });
});

describe("restCodecOf", () => {
    it.each([
        ["views", "number"], ["price", "number"], ["hits", "number"],
        ["createdAt", "timestamp"], ["day", "date"], ["opensAt", "time"],
        ["title", "passthrough"], ["meta", "passthrough"], ["place", "passthrough"],
        ["embedding", "passthrough"], ["file", "passthrough"], ["tags", "passthrough"], ["ip", "passthrough"]
    ])("%s is %s", (key, codec) => {
        expect(restCodecOf(column(key))).toBe(codec);
    });

    it("renders a foreign key by the type it has", () => {
        const foreignKey = column("authorId");
        expect(foreignKey.foreignKeyOf).toBe("author");
        expect(foreignKey.type.kind).toBe("bigint");
        expect(restCodecOf(foreignKey)).toBe("number");
    });
});
