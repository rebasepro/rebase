/**
 * A collection view's table and selection as an app's code is handed them:
 * rows as the server sends them, and ids — over the admin's own controllers,
 * which keep its `Entity` view model.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { CollectionConfig, Entity } from "@rebasepro/types";
import type { EntitySelection, EntitySelectionController, EntityTableController } from "@rebasepro/cms-types";
import { entitySelectionControllerOf, rowSelectionOf, selectionControllerOf, tableControllerOf } from "../src/util/controller_rows";
import { rowOfEntity } from "../src/util/entity_row";

const tasks = {
    slug: "tasks",
    table: "tasks",
    name: "Tasks",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        title: { type: "string", name: "Title" },
        due: { type: "date", name: "Due", columnType: "date" }
    }
} as CollectionConfig;

function task(id: string, title: string): Entity {
    return { id, path: "tasks", values: { id, title, due: new Date("2026-11-08") } };
}

function table(data: Entity[], extra: Partial<EntityTableController> = {}): EntityTableController {
    return { data, dataLoading: false, noMoreToLoad: true, ...extra };
}

function selectionController(selection: EntitySelection): EntitySelectionController {
    return {
        selection,
        setSelection: jest.fn(),
        selectedCount: selection.type === "entities" ? selection.entities.length : selection.count,
        hasSelection: selection.type === "entities" ? selection.entities.length > 0 : true,
        setSelectedEntities: jest.fn(),
        selectAllMatching: jest.fn(),
        clearSelection: jest.fn(),
        isEntitySelected: () => false,
        toggleEntitySelection: jest.fn()
    };
}

describe("tableControllerOf", () => {
    it("hands the rows as the server sends them, with the query state as it is", () => {
        const error = new Error("down");
        const setSearchString = jest.fn();
        const view = tableControllerOf(table([task("t1", "Plan")], {
            dataLoading: true,
            dataLoadingError: error,
            searchString: "pl",
            setSearchString
        }), tasks);
        expect(view.rows).toEqual([{ id: "t1", title: "Plan", due: "2026-11-08" }]);
        expect(view.loading).toBe(true);
        expect(view.error).toBe(error);
        expect(view.searchString).toBe("pl");
        expect(view.setSearchString).toBe(setSearchString);
        expect("data" in view).toBe(false);
        expect("sparseRows" in view).toBe(false);
    });

    it("is the same object for the same controller, and its rows the same rows the record hands elsewhere", () => {
        const entity = task("t1", "Plan");
        const controller = table([entity]);
        const view = tableControllerOf(controller, tasks);
        expect(tableControllerOf(controller, tasks)).toBe(view);
        expect(view.rows[0]).toBe(rowOfEntity(entity, tasks));
        // The same rows array while the data under it is the same.
        expect(tableControllerOf({ ...controller, searchString: "x" }, tasks).rows).toBe(view.rows);
    });

    it("hands every query-state field and callback of the controller through as it is", () => {
        const fields = {
            onRowsRendered: jest.fn(),
            noMoreToLoad: false,
            filterValues: { title: ["==", "Plan"] },
            setFilterValues: jest.fn(),
            sortBy: ["title", "desc"],
            setSortBy: jest.fn(),
            clearFilter: jest.fn(),
            itemCount: 40,
            setItemCount: jest.fn(),
            initialScroll: 120,
            onScroll: jest.fn(),
            paginationEnabled: true,
            pageSize: 25,
            checkFilterCombination: jest.fn(),
            onAddColumn: jest.fn()
        } as Partial<EntityTableController>;
        const view = tableControllerOf(table([], { ...fields, dataLoading: true }), tasks);
        for (const [key, value] of Object.entries(fields)) {
            expect(view).toHaveProperty(key, value);
        }
        expect(view.loading).toBe(true);
    });

    it("makes rows again for another collection, from the same controller and data", () => {
        const entity = task("t1", "Plan");
        const data = [entity];
        const sparseData = [undefined, entity];
        const controller = table(data, { sparseData });
        const bare = tableControllerOf(controller, undefined);
        const view = tableControllerOf(controller, tasks);
        expect(view).not.toBe(bare);
        expect(bare.rows[0].due).toBe("2026-11-08T00:00:00.000Z");
        expect(view.rows[0].due).toBe("2026-11-08");
        expect(view.sparseRows?.[1]?.due).toBe("2026-11-08");
        // The rows of the data alone, through another controller.
        expect(tableControllerOf(table(data, { sparseData }), tasks).rows[0].due).toBe("2026-11-08");
        expect(tableControllerOf(table(data, { sparseData }), tasks).sparseRows?.[1]?.due).toBe("2026-11-08");
    });

    it("keeps the holes of a sparse window, and the ids beside them", () => {
        const view = tableControllerOf(table([task("t2", "Ship")], { sparseData: [undefined, task("t2", "Ship")] }), tasks);
        expect(view.sparseRows).toEqual([undefined, { id: "t2", title: "Ship", due: "2026-11-08" }]);
        expect(view.sparseIds).toEqual([undefined, "t2"]);
    });

    it("hands each row's id beside it, in the same order — the id a route and the side panel take", () => {
        const view = tableControllerOf(table([task("t2", "Ship"), task("t1", "Plan")]), tasks);
        expect(view.ids).toEqual(["t2", "t1"]);
        expect("sparseIds" in view).toBe(false);
    });

    it("hands the id of a row that has no id column, and of an integer key, as a string", () => {
        const notes = {
            slug: "notes",
            table: "notes",
            name: "Notes",
            properties: { slug: { type: "string", name: "Slug", isId: true }, body: { type: "string", name: "Body" } }
        } as CollectionConfig;
        const view = tableControllerOf(table([{ id: "hello", path: "notes", values: { slug: "hello", body: "Hi" } }]), notes);
        expect(view.rows).toEqual([{ slug: "hello", body: "Hi" }]);
        expect(view.ids).toEqual(["hello"]);

        const orders = { slug: "orders", table: "orders", name: "Orders", properties: { id: { type: "number", name: "Id", isId: true } } } as CollectionConfig;
        expect(tableControllerOf(table([{ id: 5, path: "orders", values: { id: 5 } }]), orders).ids).toEqual(["5"]);
    });
});

describe("rowSelectionOf", () => {
    it("is the rows and their ids, in the order picked", () => {
        const selection = rowSelectionOf({ type: "entities", entities: [task("t2", "Ship"), task("t1", "Plan")] }, tasks);
        expect(selection).toEqual({
            type: "rows",
            ids: ["t2", "t1"],
            rows: [{ id: "t2", title: "Ship", due: "2026-11-08" }, { id: "t1", title: "Plan", due: "2026-11-08" }]
        });
    });

    it("makes rows again for another collection, from the same selection", () => {
        const selection: EntitySelection = { type: "entities", entities: [task("t1", "Plan")] };
        const bare = rowSelectionOf(selection, undefined);
        const inTasks = rowSelectionOf(selection, tasks);
        expect(bare.type === "rows" && bare.rows[0].due).toBe("2026-11-08T00:00:00.000Z");
        expect(inTasks.type === "rows" && inTasks.rows[0].due).toBe("2026-11-08");
    });

    it("is the query, with the ids ticked back off, and the count", () => {
        const query = { path: "tasks", searchString: "pl" };
        expect(rowSelectionOf({ type: "query", query, excluded: [task("t3", "Drop")], count: 12 }, tasks))
            .toEqual({ type: "query", query, excludedIds: ["t3"], count: 12 });
    });
});

describe("selectionControllerOf", () => {
    it("answers isSelected by id, in both modes", () => {
        const rows = selectionControllerOf(selectionController({ type: "entities", entities: [task("t1", "Plan")] }), tasks, "tasks");
        expect(rows.isSelected("t1")).toBe(true);
        expect(rows.isSelected("t2")).toBe(false);
        const query = selectionControllerOf(selectionController({
            type: "query", query: { path: "tasks" }, excluded: [task("t3", "Drop")], count: 9
        }), tasks, "tasks");
        expect(query.isSelected("t1")).toBe(true);
        expect(query.isSelected("t3")).toBe(false);
        expect(query.selectedCount).toBe(9);
    });

    it("hands a row back to the admin as the record it was made from", () => {
        const entity = task("t1", "Plan");
        const controller = selectionController({ type: "entities", entities: [] });
        const view = selectionControllerOf(controller, tasks, "tasks");
        view.toggleSelection(rowOfEntity(entity, tasks), true);
        expect(controller.toggleEntitySelection).toHaveBeenCalledWith(entity, true);
        view.setSelectedRows([rowOfEntity(entity, tasks)]);
        expect(controller.setSelectedEntities).toHaveBeenCalledWith([entity]);
    });

    it("addresses a row the view did not hand out by the view's path", () => {
        const controller = selectionController({ type: "entities", entities: [] });
        selectionControllerOf(controller, tasks, "projects/p1/tasks").toggleSelection({ id: "t9", title: "New", due: "2026-11-09" });
        const [entity] = jest.mocked(controller.toggleEntitySelection).mock.calls[0];
        expect(entity).toMatchObject({ id: "t9", path: "projects/p1/tasks" });
        expect(entity.values.due).toBeInstanceOf(Date);
    });

    it("on an integer key, hands string ids and reads an id either way", () => {
        const orders = {
            slug: "orders",
            name: "Orders",
            properties: { id: { type: "number", name: "Id", isId: true }, title: { type: "string", name: "Title" } }
        } as CollectionConfig;
        const five: Entity = { id: "5", path: "orders", values: { id: 5, title: "Five" } };
        const controller = selectionController({ type: "entities", entities: [five] });
        const view = selectionControllerOf(controller, orders, "orders");
        const row = rowOfEntity(five, orders);
        // The row is its columns: the key column keeps its number.
        expect(row.id).toBe(5);
        expect(view.selection).toEqual({ type: "rows", ids: ["5"], rows: [row] });
        expect(view.isSelected(5)).toBe(true);
        expect(view.isSelected("5")).toBe(true);
        view.toggleSelection({ id: 5, title: "Five" }, false);
        expect(jest.mocked(controller.toggleEntitySelection).mock.calls[0][0]).toMatchObject({ id: "5", path: "orders" });
    });

    it("is a new view for another path, addressing a row it did not hand out by that path", () => {
        const controller = selectionController({ type: "entities", entities: [] });
        const atRoot = selectionControllerOf(controller, tasks, "tasks");
        const nested = selectionControllerOf(controller, tasks, "projects/p1/tasks");
        expect(nested).not.toBe(atRoot);
        nested.toggleSelection({ id: "t9", title: "New" });
        expect(jest.mocked(controller.toggleEntitySelection).mock.calls[0][0]).toMatchObject({ path: "projects/p1/tasks" });
    });

    it("passes selectAllMatching, with its count, and clearSelection to the admin's controller", () => {
        const controller = selectionController({ type: "entities", entities: [] });
        const view = selectionControllerOf(controller, tasks, "tasks");
        const query = { path: "tasks", searchString: "pl" };
        view.selectAllMatching(query, 12);
        expect(controller.selectAllMatching).toHaveBeenCalledWith(query, 12);
        view.clearSelection();
        expect(controller.clearSelection).toHaveBeenCalledTimes(1);
    });

    it("refuses a row without its primary key", () => {
        const view = selectionControllerOf(selectionController({ type: "entities", entities: [] }), tasks, "tasks");
        expect(() => view.toggleSelection({ title: "Nameless" })).toThrow("no primary key");
    });

    it("is one view per controller, and the controller behind it can be found again", () => {
        const controller = selectionController({ type: "entities", entities: [] });
        const view = selectionControllerOf(controller, tasks, "tasks");
        expect(selectionControllerOf(controller, tasks, "tasks")).toBe(view);
        expect(entitySelectionControllerOf(view)).toBe(controller);
        expect(entitySelectionControllerOf({ ...view })).toBeUndefined();
    });
});
