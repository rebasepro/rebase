/**
 * A record's view-model values, as the server sends the row: the shape an app
 * is handed by `CollectionPanel.onRowClick` and reads with `useRows`.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { toWireRow } from "../../src/util/wire_row";

const people = {
    slug: "people",
    table: "people",
    name: "People",
    properties: { id: { type: "string", name: "Id", isId: true }, name: { type: "string", name: "Name" } }
} as CollectionConfig;

const tasks = {
    slug: "tasks",
    table: "tasks",
    name: "Tasks",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        title: { type: "string", name: "Title" },
        due: { type: "date", name: "Due", columnType: "date" },
        updatedAt: { type: "date", name: "Updated" },
        assignee: { type: "relation", name: "Assignee", relation: { kind: "belongsTo", target: () => people, localKey: "assignee_id" } },
        meta: {
            type: "map",
            name: "Meta",
            properties: { reviewedAt: { type: "date", name: "Reviewed" }, note: { type: "string", name: "Note" } }
        },
        tags: { type: "array", name: "Tags", of: { type: "string", name: "Tag" } }
    }
} as CollectionConfig;

describe("toWireRow", () => {
    it("serializes dates as the server does: date-only columns as YYYY-MM-DD, the rest RFC 3339", () => {
        const row = toWireRow({
            id: "t1",
            due: new Date("2026-11-08"),
            updatedAt: new Date("2026-11-08T09:30:00.000Z")
        }, tasks);
        expect(row).toEqual({ id: "t1", due: "2026-11-08", updatedAt: "2026-11-08T09:30:00.000Z" });
    });

    it("puts a belongsTo relation's id under its foreign key, not under the relation", () => {
        const row = toWireRow({
            id: "t1",
            assigneeId: "p1",
            assignee: new EntityRelation("p2", "people", { id: "p2", path: "people", values: { name: "Ada" } })
        }, tasks);
        expect(row).toEqual({ id: "t1", assigneeId: "p2" });
    });

    it("walks a map's children, and leaves everything else as it is", () => {
        const row = toWireRow({
            id: "t1",
            title: "Write the plan",
            meta: { reviewedAt: new Date("2026-01-02T03:04:05.000Z"), note: "ok" },
            tags: ["a", "b"],
            undeclared: { nested: true }
        }, tasks);
        expect(row).toEqual({
            id: "t1",
            title: "Write the plan",
            meta: { reviewedAt: "2026-01-02T03:04:05.000Z", note: "ok" },
            tags: ["a", "b"],
            undeclared: { nested: true }
        });
    });

    it("turns an invalid date into null, as the server reads one", () => {
        expect(toWireRow({ updatedAt: new Date("nope") }, tasks)).toEqual({ updatedAt: null });
    });
});
