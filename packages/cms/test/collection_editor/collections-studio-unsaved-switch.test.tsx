/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Switching collections in the collections editor, with an edit in progress.
 *
 * The editor for the selected collection is keyed by its id, so selecting
 * another collection — or "+" — remounts it, and whatever had been typed into
 * the one on screen is gone. Inside Studio the selection is a route, and the
 * router's navigation blocker asks first; used on its own, which is what the
 * component is exported for, the selection is plain state and nothing asked.
 *
 * The editor is a stand-in with one control that dirties it, as typing would.
 * Everything between it and the sidebar is the real thing.
 */

jest.mock("../../src/collection_editor/ui/collection_editor/CollectionEditorDialog", () => ({
    CollectionEditor: ({ editedCollectionId, isNewCollection, setFormDirty }: {
        editedCollectionId?: string;
        isNewCollection: boolean;
        setFormDirty: (dirty: boolean) => void;
    }) => (
        <div>
            <div data-testid="editing">{isNewCollection ? "new" : editedCollectionId}</div>
            <button onClick={() => setFormDirty(true)}>type something</button>
        </div>
    )
}));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        IconForView: () => null
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

class ResizeObserverStub {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

const configController = {
    readOnly: false,
    collections: [
        { slug: "posts", name: "Posts", properties: {} },
        { slug: "tags", name: "Tags", properties: {} }
    ]
} as unknown as CollectionsConfigController;

const editing = () => screen.getByTestId("editing").textContent;

function openPostsAndType() {
    render(<CollectionsStudioView configController={configController}/>);
    fireEvent.click(screen.getByText("Posts"));
    expect(editing()).toBe("posts");
    act(() => {
        fireEvent.click(screen.getByText("type something"));
    });
}

describe("switching collections with unsaved edits", () => {
    it("asks before leaving, and stays put when told to", async () => {
        openPostsAndType();

        fireEvent.click(screen.getByText("Tags"));

        expect(editing()).toBe("posts");
        const dialog = screen.getByRole("dialog");
        expect(dialog.textContent).toContain("unsaved changes");

        fireEvent.click(screen.getAllByRole("button").find(b => b.textContent?.trim().toLowerCase() === "cancel")!);
        expect(editing()).toBe("posts");
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("switches once the edits are discarded", () => {
        openPostsAndType();

        fireEvent.click(screen.getByText("Tags"));
        fireEvent.click(screen.getAllByRole("button").find(b => b.textContent?.trim().toLowerCase() === "ok")!);

        expect(editing()).toBe("tags");
    });

    it("asks before starting a new collection too", () => {
        openPostsAndType();

        fireEvent.click(screen.getByRole("button", { name: "Add collection" }));

        expect(editing()).toBe("posts");
        expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("does not ask when there is nothing to lose", () => {
        render(<CollectionsStudioView configController={configController}/>);
        fireEvent.click(screen.getByText("Posts"));
        fireEvent.click(screen.getByText("Tags"));

        expect(editing()).toBe("tags");
        expect(screen.queryByRole("dialog")).toBeNull();
    });
});
