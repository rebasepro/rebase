/**
 * A record's view-model values, as the server sends the row: the shape an app
 * is handed by `CollectionPanel.onRowClick` and reads with `useRows`.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/cms-types";
import { EntityRelation } from "@rebasepro/cms-types";
import { copyRow, fromWireRow, toWireRow } from "../src/util/wire_row";

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
        expect(flat).toEqual({ assigneeId: "p2", assignee: { name: "Ada", joinedAt: "2026-01-02T00:00:00.000Z" } });
    });

    it("nests a loaded target as exactly its columns: no `id` its table does not have", () => {
        // Keyed by `code`: the id the admin addresses the person by is not one
        // of their columns, so the nested row has no `id`, as REST's include
        // nests it.
        const byCode = {
            slug: "people",
            table: "people",
            name: "People",
            properties: { code: { type: "string", name: "Code", isId: true }, name: { type: "string", name: "Name" } }
        } as CollectionConfig;
        const tasksByCode = {
            ...tasks,
            properties: {
                ...tasks.properties,
                assignee: { type: "relation", name: "Assignee", relation: { kind: "belongsTo", target: () => byCode, localKey: "assignee_code" } }
            }
        } as CollectionConfig;
        const row = toWireRow({
            id: "t1",
            assignee: new EntityRelation("ada", "people", { id: "ada", path: "people", values: { code: "ada", name: "Ada" } })
        }, tasksByCode);
        expect(row).toEqual({ id: "t1", assigneeCode: "ada", assignee: { code: "ada", name: "Ada" } });
    });

    it("converts a loaded target's own loaded relations the same way, with no `id` added at any depth", () => {
        const assignee = new EntityRelation("p2", "people", { id: "p2", path: "people", values: { name: "Ada" } });
        const row = toWireRow({
            tasks: [new EntityRelation("t1", "tasks", { id: "t1", path: "tasks", values: { title: "Plan", assignee } })]
        }, peopleWithTasks);
        expect(row).toEqual({ tasks: [{ title: "Plan", assigneeId: "p2", assignee: { name: "Ada" } }] });
    });

    it("lists a to-many relation's loaded targets as rows", () => {
        const row = toWireRow({
            id: "p1",
            tasks: [
                new EntityRelation("t1", "tasks", { id: "t1", path: "tasks", values: { id: "t1", title: "Plan", due: new Date("2026-11-08") } }),
                new EntityRelation("t3", "tasks", { id: "t3", path: "tasks", values: { id: "t3", title: "Ship" } })
            ]
        }, peopleWithTasks);
        expect(row).toEqual({ id: "p1", tasks: [{ id: "t1", title: "Plan", due: "2026-11-08" }, { id: "t3", title: "Ship" }] });
        expect(toWireRow({ tasks: [new EntityRelation("t2", "tasks")] }, peopleWithTasks)).toEqual({ tasks: ["t2"] });
    });

    it("lists a to-many relation all as rows or all as ids: ids where any target was not loaded", () => {
        const row = toWireRow({
            tasks: [
                new EntityRelation("t1", "tasks", { id: "t1", path: "tasks", values: { title: "Plan" } }),
                new EntityRelation("t2", "tasks")
            ]
        }, peopleWithTasks);
        expect(row).toEqual({ tasks: ["t1", "t2"] });
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

describe("toWireRow, where the relation and its foreign key disagree", () => {
    it("lets the relation decide its foreign key, whichever key the values list first", () => {
        // A form that changed the relation leaves the foreign key it was read with behind.
        const row = toWireRow({ assignee: new EntityRelation("p2", "people"), assigneeId: "p1" }, tasks);
        expect(row.assigneeId).toBe("p2");
    });

    it("sends a cleared relation as a null foreign key, which unlinks it", () => {
        const row = toWireRow({ assignee: undefined }, tasks);
        expect(row).toHaveProperty("assigneeId");
        expect(row.assigneeId).toBeNull();
    });

    it("keeps a loaded target's own id, with its column's type", () => {
        const row = toWireRow({
            assignee: new EntityRelation("5", "people", { id: 5, path: "people", values: { id: 5, name: "Ada" } })
        }, tasks);
        expect(row.assignee).toEqual({ id: 5, name: "Ada" });
    });

    it("converts the dates inside an array of maps by the array's item property", () => {
        const events = {
            slug: "events",
            name: "Events",
            properties: {
                log: { type: "array", name: "Log", of: { type: "map", name: "Entry", properties: { at: { type: "date", name: "At" } } } }
            }
        } as CollectionConfig;
        const row = toWireRow({ log: [{ at: new Date("2026-11-08T09:30:00.000Z") }] }, events);
        expect(row.log).toEqual([{ at: "2026-11-08T09:30:00.000Z" }]);
    });
});

describe("copyRow", () => {
    it("copies every plain object and array, so editing the copy in place leaves the row as it was", () => {
        const row = { id: "t1", tags: ["a"], meta: { note: "ok", nested: { n: 1 } } };
        const copy = copyRow(row) as typeof row;
        copy.tags.push("b");
        copy.meta.note = "changed";
        copy.meta.nested.n = 2;
        expect(row).toEqual({ id: "t1", tags: ["a"], meta: { note: "ok", nested: { n: 1 } } });
    });
});

describe("fromWireRow, for a row edited in place", () => {
    const values = {
        id: "t1",
        title: "Plan",
        tags: ["a"],
        meta: { note: "ok" },
        assignee: new EntityRelation("p2", "people", { id: "p2", path: "people", values: { name: "Ada" } })
    };

    it("hands the values back as they were for an untouched copy, nested maps and arrays included", () => {
        const sent = toWireRow(values, tasks);
        expect(fromWireRow(values, sent, copyRow(sent), tasks, "tasks")).toBe(values);
    });

    it("sees an item pushed onto an array", () => {
        const sent = toWireRow(values, tasks);
        const returned = copyRow(sent) as { tags: string[] };
        returned.tags.push("b");
        expect(fromWireRow(values, sent, returned, tasks, "tasks").tags).toEqual(["a", "b"]);
    });

    it("sees a key added to a map", () => {
        const sent = toWireRow(values, tasks);
        const returned = copyRow(sent) as { meta: Record<string, unknown> };
        returned.meta.reviewedAt = "2026-11-08T09:30:00.000Z";
        expect(fromWireRow(values, sent, returned, tasks, "tasks").meta).toEqual({
            note: "ok",
            reviewedAt: new Date("2026-11-08T09:30:00.000Z")
        });
    });

    it("leaves the relation as it was when the belongsTo's loaded target is cleared: the foreign key is what unlinks", () => {
        const sent = toWireRow(values, tasks);
        const out = fromWireRow(values, sent, { ...sent, assignee: null }, tasks, "tasks");
        expect(out.assignee).toBe(values.assignee);
    });

    it("unlinks the relation when its foreign key is cleared or dropped", () => {
        const sent = toWireRow(values, tasks);
        expect(fromWireRow(values, sent, { ...sent, assigneeId: null }, tasks, "tasks").assignee).toBeNull();
        const { assigneeId: _assigneeId, ...withoutKey } = sent;
        expect(fromWireRow(values, sent, withoutKey, tasks, "tasks")).not.toHaveProperty("assignee");
    });
});
