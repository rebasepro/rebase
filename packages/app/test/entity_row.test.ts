/**
 * The row the admin hands app code for a record it holds as an `Entity` — an
 * entity action, a display resolver, an additional field, a form's context —
 * and the record a row it handed out stands for.
 */
import { describe, expect, it } from "@jest/globals";
import type { Entity } from "@rebasepro/types";
import type { CollectionConfig } from "@rebasepro/cms-types";
import { EntityRelation } from "@rebasepro/types";
import { entityOfRow, idOfRow, rowOfEntity } from "../src/util/entity_row";

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
        assignee: { type: "relation", name: "Assignee", relation: { kind: "belongsTo", target: () => people, localKey: "assignee_id" } }
    }
} as CollectionConfig;

function task(): Entity {
    return {
        id: "t1",
        path: "tasks",
        values: {
            title: "Write the plan",
            due: new Date("2026-11-08"),
            assignee: new EntityRelation("p2", "people", { id: "p2", path: "people", values: { id: "p2", name: "Ada" } })
        }
    };
}

describe("rowOfEntity", () => {
    it("is the row as the server sends it: its columns, an ISO date, a belongsTo as its foreign key and its loaded target", () => {
        expect(rowOfEntity(task(), tasks)).toEqual({
            title: "Write the plan",
            due: "2026-11-08",
            assigneeId: "p2",
            assignee: { id: "p2", name: "Ada" }
        });
    });

    it("is the same object for the same record, so a list or a hook dependency sees no change", () => {
        const entity = task();
        expect(rowOfEntity(entity, tasks)).toBe(rowOfEntity(entity, tasks));
        // A new version of the record is a new row.
        expect(rowOfEntity({ ...entity }, tasks)).not.toBe(rowOfEntity(entity, tasks));
    });

    it("converts again for another collection", () => {
        const entity = task();
        const bare = rowOfEntity(entity, undefined);
        expect(bare.due).toBe("2026-11-08T00:00:00.000Z");
        expect(rowOfEntity(entity, tasks)).not.toBe(bare);
    });

    it("keeps one row per collection, so two views of one record each keep theirs", () => {
        const entity = task();
        const inTasks = rowOfEntity(entity, tasks);
        const bare = rowOfEntity(entity, undefined);
        expect(rowOfEntity(entity, tasks)).toBe(inTasks);
        expect(rowOfEntity(entity, undefined)).toBe(bare);
    });

    it("hands a record that was not found no columns", () => {
        // Deliberately invalid: a record that was not found carries no `values`,
        // which `Entity` requires, and that is the case under test.
        const missing = { id: "gone", path: "tasks" } as unknown as Entity;
        expect(rowOfEntity(missing, tasks)).toEqual({});
    });
});

describe("entityOfRow", () => {
    it("gives back the record a row was made from, relation data and Date included", () => {
        const entity = task();
        expect(entityOfRow(rowOfEntity(entity, tasks), "t1", "tasks", tasks)).toBe(entity);
    });

    it("builds the record from a row it did not hand out", () => {
        const built = entityOfRow({ id: "t9", title: "Other", due: "2026-01-02", assigneeId: "p1" }, "t9", "tasks", tasks);
        expect(built.id).toBe("t9");
        expect(built.path).toBe("tasks");
        expect(built.values.title).toBe("Other");
        expect(built.values.due).toBeInstanceOf(Date);
    });

    it("keeps a row's values as they are without the collection's properties", () => {
        const row = { id: "x", name: "Ada" };
        expect(entityOfRow(row, "x", "people", undefined)).toEqual({ id: "x", path: "people", values: row });
    });
});

describe("idOfRow", () => {
    const orders = {
        slug: "orders",
        name: "Orders",
        properties: { id: { type: "number", name: "Id", isId: true }, title: { type: "string", name: "Title" } }
    } as CollectionConfig;
    const lines = {
        slug: "lines",
        name: "Lines",
        properties: {
            orderId: { type: "number", name: "Order", isId: true },
            sku: { type: "string", name: "SKU", isId: true }
        }
    } as CollectionConfig;

    it("is the record's key as a string, a composite one's parts joined", () => {
        expect(idOfRow({ id: 5, title: "Five" }, orders)).toBe("5");
        expect(idOfRow({ orderId: 5, sku: "A-1" }, lines)).toBe("5:::A-1");
    });

    it("is the admin's own id for a row it handed out", () => {
        const entity: Entity = { id: "5", path: "orders", values: { id: 5, title: "Five" } };
        expect(idOfRow(rowOfEntity(entity, orders), orders)).toBe("5");
    });

    it("is undefined for a row without its key", () => {
        expect(idOfRow({ title: "Nameless" }, orders)).toBeUndefined();
        expect(idOfRow({ orderId: 5 }, lines)).toBeUndefined();
    });

    it("is undefined for a key part that is null or empty", () => {
        expect(idOfRow({ orderId: 5, sku: "" }, lines)).toBeUndefined();
        expect(idOfRow({ orderId: null, sku: "A-1" }, lines)).toBeUndefined();
    });

    it("is the admin's id for a row it handed out whose values leave the key column out", () => {
        // The admin addresses the record by its own id; the row is only its columns.
        expect(idOfRow(rowOfEntity(task(), tasks), tasks)).toBe("t1");
    });

    it("is a row's own id, a number as a string, where the collection declares no key", () => {
        const keyless = { slug: "notes", name: "Notes", properties: { text: { type: "string", name: "Text" } } } as CollectionConfig;
        expect(idOfRow({ id: 7, text: "x" }, keyless)).toBe("7");
        expect(idOfRow({ id: 7 }, undefined)).toBe("7");
    });
});
