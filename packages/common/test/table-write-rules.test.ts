import { describe, expect, it } from "@jest/globals";
import { col, defineTable, json, rel } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { fieldOperationKind, isColumnFieldOperation } from "../src/table/field-operations";
import { textMaxLength, validationPattern } from "../src/table/validation";
import { includableRelations, queryableColumnKeys, vectorColumnKeys } from "../src/table/query-names";
import { pivotTable } from "../src/table/junction";
import { relationOf } from "../src/table/relations";

/**
 * The helpers the REST layer's write validation and query checks read a
 * table's descriptor through: which field operation a column takes, a text
 * column's pattern and length limit, the names a query may use, and the
 * junction's link columns as a table.
 */

const tags = defineTable("tags", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), label: col.text() },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.varchar({ length: 80 }),
        body: col.text().validate({ max: 2000 }),
        code: col.varchar({ length: 255 }).validate({ matches: /^[A-Z]{2}$/gi }),
        loose: col.text().validate({ matches: "/^x+$/i" }),
        plain: col.text().validate({ matches: "^y+$" }),
        views: col.integer(),
        price: col.numeric({ precision: 10, scale: 2 }),
        names: col.text().array(),
        ips: col.custom({ dataType: "inet[]" }),
        ip: col.custom({ dataType: "inet" }),
        meta: col.jsonb(json.object({ seo: json.string() })),
        free: col.jsonb(),
        blocks: col.jsonb(json.array(json.oneOf({ text: json.string() }))),
        headline: col.jsonb(json.string()),
        place: col.geopoint(),
        published: col.boolean(),
        embedding: col.vector({ dimensions: 3 }),
        secret: col.text().private(),
        hidden: col.vector({ dimensions: 3 }).private(),
        authorId: col.uuid()
    },
    relations: {
        author: rel.belongsTo(() => tags, { localKey: "author_id" }),
        tagged: rel.manyToMany(() => tags, {
            through: "posts_tags",
            pivot: { role: col.text({ enum: ["owner", "viewer"] }).notNull() }
        }),
        secretTags: rel.manyToMany(() => tags, { through: "posts_secret_tags", private: true })
    },
    rls: "admin-only"
});

const [, postsT] = compileTables([tags, posts]);
const column = (key: string) => {
    const found = postsT.columns.find(c => c.key === key);
    if (!found) throw new Error(`no column ${key}`);
    return found;
};

describe("fieldOperationKind", () => {
    it("names the value an operator acts on, from the column type and the JSON shape", () => {
        expect(fieldOperationKind(column("views"))).toBe("number");
        expect(fieldOperationKind(column("price"))).toBe("number");
        expect(fieldOperationKind(column("names"))).toBe("array");
        expect(fieldOperationKind(column("ips"))).toBe("array");
        expect(fieldOperationKind(column("blocks"))).toBe("array");
        expect(fieldOperationKind(column("meta"))).toBe("document");
        expect(fieldOperationKind(column("free"))).toBe("document");
    });

    it("takes no operator on text, booleans, points, vectors, scalar documents and custom scalars", () => {
        for (const key of ["title", "published", "place", "embedding", "headline", "ip"]) {
            expect(fieldOperationKind(column(key))).toBeUndefined();
        }
    });
});

describe("isColumnFieldOperation", () => {
    it("reads a $-keyed object on a document column as data unless it is one real operator", () => {
        expect(isColumnFieldOperation({ $ref: "#/a" }, column("meta"))).toBe(false);
        expect(isColumnFieldOperation({ $merge: { seo: "x" } }, column("meta"))).toBe(true);
    });

    it("reads any $ key as an attempted operation elsewhere, and without a column", () => {
        expect(isColumnFieldOperation({ $increment: 1 }, column("views"))).toBe(true);
        expect(isColumnFieldOperation({ $set: 1 }, undefined)).toBe(true);
        expect(isColumnFieldOperation(5, column("views"))).toBe(false);
    });
});

describe("validationPattern", () => {
    it("rebuilds a RegExp from its source and flags, without g and y", () => {
        const pattern = validationPattern(column("code").validate);
        expect(pattern?.flags).toBe("i");
        expect(pattern?.test("us")).toBe(true);
        expect(pattern?.test("us")).toBe(true);
    });

    it("reads a string the way the panel does, slashes and flags included", () => {
        expect(validationPattern(column("loose").validate)?.test("XX")).toBe(true);
        expect(validationPattern(column("plain").validate)?.test("yy")).toBe(true);
        expect(validationPattern(column("title").validate)).toBeUndefined();
        expect(validationPattern({ matches: "[" })).toBeUndefined();
    });
});

describe("textMaxLength", () => {
    it("is the stated max, else a non-default varchar length", () => {
        expect(textMaxLength(column("body"))).toBe(2000);
        expect(textMaxLength(column("title"))).toBe(80);
        expect(textMaxLength(column("code"))).toBeUndefined();
        expect(textMaxLength(column("plain"))).toBeUndefined();
    });
});

describe("query names", () => {
    it("lists every column but the private ones, foreign keys included", () => {
        const keys = queryableColumnKeys(postsT);
        expect(keys).toContain("authorId");
        expect(keys).toContain("title");
        expect(keys).not.toContain("secret");
        expect(keys).toEqual([...keys].sort());
    });

    it("lists the relations an include may name, and the vector columns, never a private one", () => {
        expect(includableRelations(postsT)).toEqual(["author", "tagged"]);
        expect(vectorColumnKeys(postsT)).toEqual(["embedding"]);
    });
});

describe("pivotTable", () => {
    it("is the link's columns as a table with no key, relation or grant", () => {
        const relation = relationOf(postsT, "tagged");
        if (relation?.kind !== "manyToMany") throw new Error("expected a manyToMany");
        const junction = pivotTable(postsT, relation);
        expect(junction.slug).toBe("posts_tags");
        expect(junction.columns.map(c => c.key)).toEqual(["role"]);
        expect(junction.columns[0].nullable).toBe(false);
        expect(junction.primaryKey).toEqual([]);
        expect(junction.relations).toEqual([]);
        expect(junction.rls).toEqual({ posture: "rules", rules: [], defaultPolicies: false });
    });
});
