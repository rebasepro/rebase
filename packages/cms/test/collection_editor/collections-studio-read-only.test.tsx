/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * The collections editor on a server that cannot edit collections.
 *
 * The empty state offered a primary "Add new collection" button, disabled,
 * with the reason only in the tooltip of the small "+" in the sidebar header:
 * a dead button and nothing on screen to say why.
 */

jest.mock("../../src/collection_editor/ui/collection_editor/CollectionEditorDialog", () => ({
    CollectionEditor: () => null
}));

jest.mock("@rebasepro/app", () => {
    // The English strings, as a person reads them.
    const { en } = jest.requireActual("../../../app/src/locales/en") as { en: Record<string, string> };
    const overrides: Record<string, unknown> = {
        IconForView: () => null,
        useTranslation: () => ({ t: (key: string) => en[key] ?? key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { CollectionsStudioView } from "../../src/collection_editor/ui/collection_editor/CollectionsStudioView";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";

Object.assign(global, {
    ResizeObserver: class {
        observe() { return undefined; }
        unobserve() { return undefined; }
        disconnect() { return undefined; }
    }
});

const controller = (readOnly: boolean, readOnlyReason?: string) => ({
    readOnly,
    readOnlyReason,
    collections: [{ slug: "posts", name: "Posts", properties: {} }]
}) as unknown as CollectionsConfigController;

describe("the collections editor's empty state", () => {
    it("says why nothing can be added, instead of offering a disabled button", () => {
        render(<CollectionsStudioView
            configController={controller(true, "The schema editor is off under NODE_ENV=production.")}/>);
        expect(screen.getByText("The schema editor is off under NODE_ENV=production.")).toBeTruthy();
        // The sidebar's "+" stays, disabled, with the reason as its tooltip.
        expect(screen.queryByText("Add new collection")).toBeNull();
    });

    it("offers to add a collection where one can be added", () => {
        render(<CollectionsStudioView configController={controller(false)}/>);
        expect(screen.getByText("Add new collection").closest("button")).toBeTruthy();
    });
});
