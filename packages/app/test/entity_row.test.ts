/**
 * The row the admin hands app code for a record it holds as an `Entity` — an
 * entity action, a display resolver, an additional field, a form's context —
 * and the record a row it handed out stands for.
 */
import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig, Entity } from "@rebasepro/types";
import { EntityRelation } from "@rebasepro/types";
import { entityOfRow, rowOfEntity } from "../src/util/entity_row";

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
            assignee: new EntityRelation("p2", "people", { id: "p2", path: "people", values: { name: "Ada" } })
        }
    };
}

describe("rowOfEntity", () => {
    it("is the row as the server sends it: id, an ISO date, a belongsTo as its foreign key and its loaded target", () => {
        expect(rowOfEntity(task(), tasks)).toEqual({
            id: "t1",
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

    it("hands a record that was not found its id alone", () => {
        const missing = { id: "gone", path: "tasks" } as unknown as Entity;
        expect(rowOfEntity(missing, tasks)).toEqual({ id: "gone" });
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
