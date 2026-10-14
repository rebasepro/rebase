/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { AdminCollection } from "@rebasepro/cms-types";

/**
 * The relation picker speaks the admin's language.
 *
 * Its title ("Select Tag", "Select from Tags") and its Clear and Done buttons
 * were English literals, in a dialog whose "Add Tag" button beside them was
 * translated. The keys already existed in every locale.
 */

jest.mock("../../src/hooks/useSidePanel", () => {
    const controller = { open: () => undefined, close: () => undefined, replace: () => undefined };
    return { useSidePanel: () => controller };
});

jest.mock("../../src/hooks/navigation/contexts/UrlContext", () => {
    const controller = { resolveDatabasePathsFrom: (p: string) => p };
    return { useUrlController: () => controller };
});

jest.mock("../../src/components/SideDialogs", () => {
    const context = { close: () => undefined, setBlocked: () => undefined };
    return { useSideDialogContext: () => context };
});

// The table is not under test: it renders the title and the actions slot the
// picker hands it.
jest.mock("../../src/components/CollectionTableBinding", () => ({
    CollectionTableBinding: ({ title, actions }: { title?: React.ReactNode, actions?: React.ReactNode }) =>
        <div>{title}{actions}</div>,
    CollectionRowActions: () => null
}));

jest.mock("@rebasepro/app", () => {
    const analytics = { onAnalyticsEvent: () => undefined };
    const data = { collection: () => ({}) };
    const tableController = {};
    const columnIds: string[] = [];
    const permissions = { canCreate: () => false };
    const overrides: Record<string, unknown> = {
        CollectionScopeProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
        IconForView: () => null,
        useAuthController: () => ({}),
        useCustomizationController: () => ({}),
        useAnalyticsController: () => analytics,
        useData: () => data,
        useDataTableController: () => tableController,
        useColumnIds: () => columnIds,
        useLargeLayout: () => true,
        usePermissions: () => permissions
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { RebaseI18nProvider } from "@rebasepro/app";
import { SelectionTableBinding } from "../../src/components/ReferenceTable/SelectionTableBinding";

beforeAll(() => {
    Object.assign(Element.prototype, { scrollIntoView: () => undefined });
});

const tags: AdminCollection<{ name: string }> = {
    slug: "tags",
    name: "Tags",
    singularName: "Tag",
    properties: { name: { type: "string", name: "Name" } }
};

function renderPicker(locale: string, collection: AdminCollection<{ name: string }>) {
    return render(
        <RebaseI18nProvider locale={locale}>
            <SelectionTableBinding<{ name: string }> collection={collection} path="tags" multiselect={true}/>
        </RebaseI18nProvider>
    );
}

describe("the relation picker, in Italian", () => {
    it("names what it selects and its buttons in Italian", async () => {
        renderPicker("it", tags);

        expect(await screen.findByText("Seleziona Tag")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Cancella" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Fatto" })).toBeTruthy();

        expect(screen.queryByText("Select Tag")).toBeNull();
        expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
    });

    it("names the collection it selects from when it has no singular name", async () => {
        renderPicker("it", { ...tags, singularName: undefined });

        expect(await screen.findByText("Seleziona da Tags")).toBeTruthy();
        expect(screen.queryByText("Select from Tags")).toBeNull();
    });
});
