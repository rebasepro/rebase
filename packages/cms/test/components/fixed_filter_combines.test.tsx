/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FilterValues, Properties } from "@rebasepro/types";
import type { EntityTableController } from "@rebasepro/cms-types";

/**
 * A collection's `fixedFilter` scopes the view; the user's filters combine with
 * it. The table header used to switch every column's filter off when a fixed
 * filter was set — while the filters dialog offered the same fields — and the
 * clear button disappeared altogether, sort included. Now the fixed fields are
 * locked and nothing else is.
 */

import { propertiesToColumns } from "../../src/components/CollectionTableBinding/column_utils";
import { ClearFilterSortButton } from "../../src/components/ClearFilterSortButton";
import { fakeTableController } from "../helpers/fakes";

const properties: Properties = {
    name: { name: "Name", type: "string" },
    status: { name: "Status", type: "string" }
};

const fixedFilter: FilterValues<string> = { status: ["==", "active"] };

describe("a fixed filter locks its own fields, not the table", () => {

    it("keeps the header filter on every other column", () => {
        const columns = propertiesToColumns({ properties, sortable: true, fixedFilter: { status: ["==", "active"] } });
        const filterable = Object.fromEntries(columns.map(column => [column.key, column.filter]));
        expect(filterable).toEqual({ name: true, status: false });
    });

    it("offers no clear button for the fixed filter alone", () => {
        const controller = fakeTableController([], { filterValues: { ...fixedFilter }, clearFilter: jest.fn(), setSortBy: jest.fn() });
        const { container } = render(<ClearFilterSortButton enabled={true} tableController={controller} fixedFilter={{ ...fixedFilter }}/>);
        expect(container.querySelector("button")).toBeNull();
    });

    it("clears what the user applied on top of it", () => {
        const clearFilter = jest.fn();
        const controller = fakeTableController([], {
            filterValues: { ...fixedFilter, name: ["==", "bob"] },
            clearFilter,
            setSortBy: jest.fn()
        });
        render(<ClearFilterSortButton enabled={true} tableController={controller} fixedFilter={{ ...fixedFilter }}/>);
        fireEvent.click(screen.getByRole("button"));
        expect(clearFilter).toHaveBeenCalled();
    });
});
