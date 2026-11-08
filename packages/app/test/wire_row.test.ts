/**
 * A record's view-model values, as the server sends the row: the shape an app
 * is handed by `CollectionPanel.onRowClick` and reads with `useRows`.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { fromWireRow, toWireRow } from "../src/util/wire_row";

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

const peopleWithTasks = {
    slug: "people",
    table: "people",
    name: "People",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        name: { type: "string", name: "Name" },
        tasks: { type: "relation", name: "Tasks", relation: { kind: "hasMany", target: () => tasks, foreignKey: "assignee_id" } }
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

    it("puts a belongsTo relation's id under its foreign key, and nothing under the relation when only its id is held", () => {
        const row = toWireRow({
            id: "t1",
            assigneeId: "p1",
            assignee: new EntityRelation("p2", "people")
        }, tasks);
        expect(row).toEqual({ id: "t1", assigneeId: "p2" });
    });

    it("nests a loaded belongsTo target under the relation's name, as REST's include does, beside its foreign key", () => {
        const row = toWireRow({
            id: "t1",
            assignee: new EntityRelation("p2", "people", { id: "p2", path: "people", values: { id: "p2", name: "Ada" } })
        }, tasks);
        expect(row).toEqual({ id: "t1", assigneeId: "p2", assignee: { id: "p2", name: "Ada" } });
    });

    it("converts a loaded target by its own collection, and a target the socket delivered flat", () => {
        const flat = toWireRow({
            assignee: new EntityRelation("p2", "people", { name: "Ada", joinedAt: new Date("2026-01-02T00:00:00.000Z") })
        }, tasks);
        expect(flat).toEqual({ assigneeId: "p2", assignee: { id: "p2", name: "Ada", joinedAt: "2026-01-02T00:00:00.000Z" } });
    });

    it("lists a to-many relation's loaded targets as rows, the ones not loaded as ids", () => {
        const row = toWireRow({
            id: "p1",
            tasks: [
                new EntityRelation("t1", "tasks", { id: "t1", path: "tasks", values: { title: "Plan", due: new Date("2026-11-08") } }),
                new EntityRelation("t2", "tasks")
            ]
        }, peopleWithTasks);
        expect(row).toEqual({ id: "p1", tasks: [{ id: "t1", title: "Plan", due: "2026-11-08" }, "t2"] });
        expect(toWireRow({ tasks: [new EntityRelation("t2", "tasks")] }, peopleWithTasks)).toEqual({ tasks: ["t2"] });
    });

    it("leaves the loaded targets out of a row that is written", () => {
        const row = toWireRow({
            assignee: new EntityRelation("p2", "people", { id: "p2", path: "people", values: { name: "Ada" } })
        }, tasks, { included: false });
        expect(row).toEqual({ assigneeId: "p2" });
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

describe("fromWireRow", () => {
    const assignee = new EntityRelation("p2", "people", { id: "p2", path: "people", values: { name: "Ada" } });
    const updatedAt = new Date("2026-11-08T09:30:00.000Z");
    const values = { id: "t1", title: "Plan", assignee, updatedAt };

    it("hands the values back as they were when the row comes back unchanged", () => {
        const sent = toWireRow(values, tasks);
        expect(fromWireRow(values, sent, sent, tasks, "tasks")).toBe(values);
        expect(fromWireRow(values, sent, { ...sent }, tasks, "tasks")).toBe(values);
    });

    it("converts only what changed, and keeps the admin's own value for the rest", () => {
        const sent = toWireRow(values, tasks);
        const out = fromWireRow(values, sent, { ...sent, title: "Plan v2", updatedAt: "2026-12-01T00:00:00.000Z" }, tasks, "tasks");
        expect(out.title).toBe("Plan v2");
        expect(out.updatedAt).toEqual(new Date("2026-12-01T00:00:00.000Z"));
        // Untouched: the relation keeps the target's columns it was read with.
        expect(out.assignee).toBe(assignee);
    });

    it("turns a changed foreign key back into the relation", () => {
        const sent = toWireRow(values, tasks);
        const out = fromWireRow(values, sent, { ...sent, assigneeId: "p9" }, tasks, "tasks");
        expect(out.assignee).toBeInstanceOf(EntityRelation);
        expect((out.assignee as EntityRelation).id).toBe("p9");
    });

    it("drops what the row dropped", () => {
        const sent = toWireRow(values, tasks);
        const { title: _title, ...rest } = sent;
        expect(fromWireRow(values, sent, rest, tasks, "tasks")).not.toHaveProperty("title");
    });
});
