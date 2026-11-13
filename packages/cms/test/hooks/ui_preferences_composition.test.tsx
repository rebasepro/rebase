/**
 * The composition order of a served table's collection:
 *
 *   projected table → code customizations → workspace preferences
 *   (`<RebaseCMS uiConfig>`, then the server's) → user preferences
 *
 * Each layer is asserted to win over the ones before it, and to leave what it
 * does not name alone.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import type { AdminCollection, TableCustomizationOptions } from "@rebasepro/cms-types";
import type { TableDescriptor, UiTablePreferences } from "@rebasepro/types";
import { col, defineTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

import { composeCollections } from "../../src/hooks/navigation/compose_collections";
import { applyUiPreferences, isColorKey } from "../../src/hooks/navigation/ui_preferences";
import { userPreferencesOverlay } from "../../src/hooks/navigation/user_preferences_overlay";
import { useBuildCollectionRegistryController } from "../../src/hooks/navigation/useBuildCollectionRegistryController";
import { customizeTable } from "../../src/tables/customize_table";
import { fakeUserConfigPersistence } from "../helpers/fakes";

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        status: col.enum(["draft", "published"]).notNull().default("draft")
    },
    rls: "admin-only"
});
const tables: TableDescriptor[] = compileTables([posts]);

let warn: jest.SpiedFunction<typeof console.warn>;
beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => warn.mockRestore());

const compose = (layers: { code?: TableCustomizationOptions; file?: UiTablePreferences; workspace?: UiTablePreferences }) => {
    const [collection] = composeCollections({
        tables,
        tableCustomizations: layers.code ? [customizeTable("posts", layers.code)] : [],
        externalCollections: [],
        uiConfig: layers.file ? { tables: { posts: layers.file } } : undefined,
        workspacePreferences: layers.workspace ? { tables: { posts: layers.workspace } } : undefined
    });
    return collection;
};

describe("the composition order", () => {
    it("projected → code → shipped ui-config → server workspace, each over the one before", () => {
        expect(compose({}).name).toBe("Posts");
        expect(compose({ code: { name: "Code", icon: "Code" } })).toMatchObject({ name: "Code", icon: "Code" });
        expect(compose({ code: { name: "Code", icon: "Code" }, file: { name: "File" } })).toMatchObject({ name: "File", icon: "Code" });
        expect(compose({ code: { name: "Code", icon: "Code" }, file: { name: "File", group: "Content" }, workspace: { name: "Workspace" } }))
            .toMatchObject({ name: "Workspace", icon: "Code", group: "Content" });
    });

    it("folds field preferences into the view model: labels, widths, hidden columns, enum labels", () => {
        const collection = compose({
            workspace: {
                fieldOrder: ["status", "title"],
                fields: {
                    title: { name: "Headline", columnWidth: 320, hidden: false },
                    status: { enumLabels: { draft: { label: "Work in progress", color: "grayLight" }, published: "Live" } }
                }
            }
        });
        expect(collection.propertiesOrder).toEqual(["status", "title"]);
        expect(collection.properties.title).toMatchObject({ name: "Headline", admin: { columnWidth: 320, hideFromCollection: false } });
        const status = collection.properties.status;
        expect(status.type === "string" && status.enum).toEqual([
            expect.objectContaining({ id: "draft", label: "Work in progress", color: "grayLight" }),
            expect.objectContaining({ id: "published", label: "Live" })
        ]);
    });

    it("skips a shipped entry that is not a preference", () => {
        const [collection] = composeCollections({
            tables, tableCustomizations: [], externalCollections: [],
            uiConfig: { tables: { posts: { columns: { title: { type: "text" } } } } }
        });
        expect(collection.name).toBe("Posts");
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("uiConfig.tables[\"posts\"]"));
    });

    it("adds registered actions beside the code's objects, never instead of them", () => {
        const publish = { key: "publish", name: "Publish", onClick: async () => undefined };
        const collection = compose({ code: { entityActions: [publish] }, workspace: { entityActions: ["archive"] } });
        expect(collection.entityActions).toEqual([publish, "archive"]);
    });

    it("drops a colour that is not a chip colour key", () => {
        expect(isColorKey("orangeDark")).toBe(true);
        expect(isColorKey("green")).toBe(true);
        expect(isColorKey("#ff0000")).toBe(false);
        const [base] = composeCollections({ tables, tableCustomizations: [], externalCollections: [] });
        const applied = applyUiPreferences(base, { fields: { status: { enumLabels: { draft: { label: "D", color: "#ff0000" } } } } });
        const status = applied.properties.status;
        expect(status.type === "string" && Array.isArray(status.enum) && status.enum[0]).toEqual(expect.not.objectContaining({ color: "#ff0000" }));
    });
});

describe("the user's layer, last", () => {
    it("maps a user's preferences back to the view model, leaving out fields the collection lacks", () => {
        expect(userPreferencesOverlay({
            defaultViewMode: "kanban",
            kanban: { columnField: "status" },
            fieldOrder: ["title"],
            fields: { title: { columnWidth: 200, hidden: true }, ghost: { columnWidth: 1 } }
        }, new Set(["title", "status"]))).toEqual({
            defaultViewMode: "kanban",
            kanban: { columnProperty: "status" },
            propertiesOrder: ["title"],
            properties: { title: { admin: { columnWidth: 200, hideFromCollection: true } } }
        });
    });

    it("wins over the workspace's, in the registry, when the view asks for it", async () => {
        const collection = compose({ workspace: { defaultViewMode: "cards", fields: { title: { columnWidth: 320 } } } });
        const persistence = fakeUserConfigPersistence({ getTablePreferences: () => ({ defaultViewMode: "kanban", fields: { title: { columnWidth: 180 } } }) });
        const { result } = renderHook(() => useBuildCollectionRegistryController({ userConfigPersistence: persistence }));
        await act(async () => {
            result.current.collectionRegistryRef.current.registerMultiple([collection]);
        });
        const resolved = result.current.getCollection("posts", true);
        expect(resolved?.defaultViewMode).toBe("kanban");
        expect(resolved?.properties.title.admin?.columnWidth).toBe(180);
        // The default read is the workspace's: the user's layer is theirs alone.
        expect(result.current.getCollection("posts")?.defaultViewMode).toBe("cards");
    });
});
