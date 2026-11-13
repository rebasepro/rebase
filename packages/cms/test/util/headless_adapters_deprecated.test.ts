import { renderHook } from "@testing-library/react";
import { resetDeprecationWarningsForTests } from "@rebasepro/common";
import type { EntityTableController, Properties, StringProperty } from "@rebasepro/cms-types";
import { mapPropertiesToConfigs, mapPropertyToConfig } from "../../src/util/propertyConfigMapper";
import { createStaticDataController, useCollectionDataController } from "../../src/util/dataControllerAdapter";
import { fakeTableController } from "../helpers/fakes";

/**
 * The four adapters that feed `CollectionView` from `@rebasepro/ui` are
 * deprecated with it: `CollectionPanel` renders a collection without them.
 * Each still returns what it did, and warns exactly once, naming the
 * replacement.
 */
describe("the headless CollectionView adapters (deprecated)", () => {
    let warn: jest.SpyInstance;

    beforeEach(() => {
        resetDeprecationWarningsForTests();
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => warn.mockRestore());

    function deprecationsNaming(name: string): unknown[][] {
        return warn.mock.calls.filter(([message]) => String(message).startsWith(`[Rebase] Deprecated: \`${name}\``));
    }

    it("mapPropertyToConfig still maps, and warns once", () => {
        const property = { type: "string", name: "Job title" } as StringProperty;
        expect(mapPropertyToConfig(property, "jobTitle").name).toBe("Job title");
        mapPropertyToConfig(property, "jobTitle");
        expect(deprecationsNaming("mapPropertyToConfig")).toHaveLength(1);
        expect(String(deprecationsNaming("mapPropertyToConfig")[0][0])).toContain("CollectionPanel");
    });

    it("mapPropertiesToConfigs still maps, and warns once under its own name", () => {
        const properties: Properties = { title: { type: "string" }, tags: { type: "array", of: { type: "string" } } };
        const configs = mapPropertiesToConfigs(properties);
        expect(configs.title.name).toBe("Title");
        expect(configs.tags.of?.type).toBe("string");
        mapPropertiesToConfigs(properties);
        expect(deprecationsNaming("mapPropertiesToConfigs")).toHaveLength(1);
        expect(deprecationsNaming("mapPropertyToConfig")).toHaveLength(0);
    });

    it("createStaticDataController still builds a controller, and warns once", () => {
        const rows = [{ id: "1" }];
        expect(createStaticDataController(rows)).toEqual({ data: rows, loading: false, noMoreToLoad: true, error: undefined });
        createStaticDataController(rows);
        expect(deprecationsNaming("createStaticDataController")).toHaveLength(1);
    });

    it("useCollectionDataController still unwraps the rows, and warns once", () => {
        const tableController = fakeTableController<{ id: string; name: string }>(
            [{ id: "1", path: "people", values: { id: "1", name: "Ada" } }]);
        const { result, rerender } = renderHook(() => useCollectionDataController(tableController));
        expect(result.current.data).toEqual([{ id: "1", name: "Ada" }]);
        rerender();
        expect(deprecationsNaming("useCollectionDataController")).toHaveLength(1);
    });
});
