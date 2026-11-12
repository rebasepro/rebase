import { describe, expect, it } from "@jest/globals";
import { col, defineTable, json } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { storageAt, storagePositions } from "../src/table/storage";
import { formatJsonPath } from "../src/table/json-shape";

/**
 * Where a table holds stored files — the one answer the upload limits, the
 * public-read decision and the orphan sweep read.
 */

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text(),
        cover: col.storage({ path: "posts/covers", accept: ["image/*"], maxBytes: "1MB", source: "media" }),
        gallery: col.storage({ path: "posts/gallery", public: true }).multiple(),
        attachments: col.array(col.storage({ path: "posts/attachments", maxBytes: 10 })),
        content: col.jsonb(json.object({
            seo: json.object({ image: json.storage({ path: "posts/seo" }), title: json.string() }),
            blocks: json.array(json.oneOf({
                image: json.object({ src: json.storage({ path: "posts/blocks" }) }),
                text: json.string()
            })),
            figures: json.array(json.object({ file: json.storage({ path: "posts/figures" }) }))
        })),
        loose: col.jsonb()
    },
    rls: "admin-only"
});

const [table] = compileTables([posts]);

describe("storagePositions", () => {
    it("finds every stored file: columns, array items, and json fields at any depth", () => {
        const found = storagePositions(table).map(position => ({
            at: [position.column.key, formatJsonPath(position.path)].filter(Boolean).join(":"),
            path: position.storage.path
        }));
        expect(found).toEqual([
            { at: "cover", path: "posts/covers" },
            { at: "gallery:[]", path: "posts/gallery" },
            { at: "attachments:[]", path: "posts/attachments" },
            { at: "content:seo.image", path: "posts/seo" },
            { at: "content:blocks[].image.src", path: "posts/blocks" },
            { at: "content:figures[].file", path: "posts/figures" }
        ]);
    });

    it("carries the stored rules: source, accept, bytes, public", () => {
        const [cover, gallery, attachments] = storagePositions(table);
        expect(cover.storage).toEqual({ path: "posts/covers", accept: ["image/*"], maxBytes: 1024 * 1024, source: "media" });
        expect(gallery.storage.public).toBe(true);
        expect(attachments.storage.maxBytes).toBe(10);
    });

    it("is empty for a table that stores no files", () => {
        const plain = defineTable("plain", { columns: { id: col.uuid().primaryKey(), name: col.text() }, rls: "admin-only" });
        expect(storagePositions(compileTables([plain])[0])).toEqual([]);
    });
});

describe("storageAt", () => {
    it("resolves a column, its items, and a json field", () => {
        expect(storageAt(table, "cover")?.path).toBe("posts/covers");
        expect(storageAt(table, "gallery")?.path).toBe("posts/gallery");
        expect(storageAt(table, "gallery.3")?.path).toBe("posts/gallery");
        expect(storageAt(table, "content.seo.image")?.path).toBe("posts/seo");
        expect(storageAt(table, "content.figures.0.file")?.path).toBe("posts/figures");
    });

    it("answers undefined for what holds no file, or cannot be addressed", () => {
        expect(storageAt(table, "title")).toBeUndefined();
        expect(storageAt(table, "content.seo.title")).toBeUndefined();
        expect(storageAt(table, "content.seo")).toBeUndefined();
        expect(storageAt(table, "missing")).toBeUndefined();
        expect(storageAt(table, "")).toBeUndefined();
        // A oneOf block's variant is in the row, not the address.
        expect(storageAt(table, "content.blocks.0.src")).toBeUndefined();
    });
});
