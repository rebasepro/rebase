/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { AdminCollection, Entity } from "@rebasepro/cms-types";

/**
 * `useSelectionDialog({ path })` without a `collection` shows the collection
 * registered under the path, and hands the rows picked as that collection
 * reads them — a date-only column as `YYYY-MM-DD`, not a timestamp.
 */

const events = {
    slug: "events",
    name: "Events",
    properties: {
        id: { type: "number", name: "Id", isId: true },
        title: { type: "string", name: "Title" },
        day: { type: "date", name: "Day", columnType: "date" }
    }
} as AdminCollection;

const opened: { component: React.ReactElement }[] = [];
jest.mock("../../src/hooks/useSideDialogsController", () => {
    const controller = { open: (props: { component: React.ReactElement }) => opened.push(props), close: () => undefined };
    return { useSideDialogsController: () => controller };
});
jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => {
    const registry = { getCollection: (path: string) => path === "events" ? events : undefined };
    return { useCollectionRegistryController: () => registry };
});

import { useSelectionDialog } from "../../src/hooks/useSelectionDialog";

type PickerProps = { onSelectionDone?: (entities: Entity[]) => void };

describe("useSelectionDialog without a collection", () => {
    it("hands the rows picked, and their ids, as the collection registered at the path reads them", () => {
        const onSelectionDone = jest.fn<(rows: Record<string, unknown>[], ids: string[]) => void>();
        const { result } = renderHook(() => useSelectionDialog({ path: "events", multiselect: true, onSelectionDone }));
        result.current.open();

        const picker = opened[opened.length - 1].component.props as PickerProps;
        picker.onSelectionDone?.([{ id: "5", path: "events", values: { id: 5, title: "Launch", day: new Date("2026-11-08") } }]);

        expect(onSelectionDone).toHaveBeenCalledWith([{ id: 5, title: "Launch", day: "2026-11-08" }], ["5"]);
    });
});
