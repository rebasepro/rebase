/**
 * @jest-environment jsdom
 */
import { mergeSnapshotActions } from "../../src/util/snapshot_actions";
import type { SnapshotAction } from "@rebasepro/types";

describe("mergeSnapshotActions", () => {

    const editAction: SnapshotAction = {
        key: "edit",
        name: "Edit",
        onClick: jest.fn()
    } as unknown as SnapshotAction;

    const deleteAction: SnapshotAction = {
        key: "delete",
        name: "Delete",
        onClick: jest.fn()
    } as unknown as SnapshotAction;

    const copyAction: SnapshotAction = {
        key: "copy",
        name: "Copy",
        onClick: jest.fn()
    } as unknown as SnapshotAction;

    const customAction: SnapshotAction = {
        key: "export",
        name: "Export Data",
        onClick: jest.fn()
    } as unknown as SnapshotAction;

    const anotherCustom: SnapshotAction = {
        key: "archive",
        name: "Archive",
        onClick: jest.fn()
    } as unknown as SnapshotAction;

    it("returns the original actions when new list is empty", () => {
        const result = mergeSnapshotActions([editAction, deleteAction], []);
        expect(result).toEqual([editAction, deleteAction]);
    });

    it("returns the new actions when current list is empty", () => {
        const result = mergeSnapshotActions([], [customAction, anotherCustom]);
        expect(result).toEqual([customAction, anotherCustom]);
    });

    it("replaces existing actions with the same key", () => {
        const updatedEdit: SnapshotAction = {
            key: "edit",
            name: "Edit V2",
            onClick: jest.fn()
        } as unknown as SnapshotAction;

        const result = mergeSnapshotActions([editAction, deleteAction], [updatedEdit]);
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("Edit V2");
        expect(result[1].key).toBe("delete");
    });

    it("appends new non-reserved actions", () => {
        const result = mergeSnapshotActions([editAction], [customAction]);
        expect(result).toHaveLength(2);
        expect(result[0].key).toBe("edit");
        expect(result[1].key).toBe("export");
    });

    it("does NOT append new actions with reserved keys (edit, copy, delete) unless they replace existing ones", () => {
        // If "delete" is not in the current list, it shouldn't be added since it's reserved
        const result = mergeSnapshotActions([editAction], [deleteAction]);
        // delete is reserved and not in current actions => not appended
        expect(result).toHaveLength(1);
        expect(result[0].key).toBe("edit");
    });

    it("does append a custom action that replaces an existing reserved key", () => {
        const customDeleteOverride: SnapshotAction = {
            key: "delete",
            name: "Custom Delete",
            onClick: jest.fn()
        } as unknown as SnapshotAction;

        // "delete" is in current actions, so it gets replaced
        const result = mergeSnapshotActions([editAction, deleteAction], [customDeleteOverride]);
        expect(result).toHaveLength(2);
        const mergedDelete = result.find(a => a.key === "delete");
        expect(mergedDelete?.name).toBe("Custom Delete");
    });

    it("handles actions with undefined keys", () => {
        const noKeyAction: SnapshotAction = {
            name: "No Key Action",
            onClick: jest.fn()
        } as unknown as SnapshotAction;

        const result = mergeSnapshotActions([editAction], [noKeyAction]);
        // key is undefined, which is not in reservedKeys, so it should be appended
        expect(result).toHaveLength(2);
        expect(result[1].name).toBe("No Key Action");
    });

    it("merges properties from both current and new action on key match", () => {
        const baseAction: SnapshotAction = {
            key: "export",
            name: "Export",
            icon: "download"
        } as unknown as SnapshotAction;

        const overrideAction: SnapshotAction = {
            key: "export",
            name: "Export CSV"
        } as unknown as SnapshotAction;

        const result = mergeSnapshotActions([baseAction], [overrideAction]);
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("Export CSV");
        // icon from base should still be preserved via spread
        expect((result[0] as any).icon).toBe("download");
    });

    it("handles both lists empty", () => {
        const result = mergeSnapshotActions([], []);
        expect(result).toEqual([]);
    });
});
