/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { EntityRelation, type Relation } from "@rebasepro/types";

/**
 * Pointing a relation at a row that does not exist yet.
 *
 * The picker could only ever select something already in the target
 * collection. When it was not there, the only way through was to abandon the
 * form, go to the other collection, create the row and start again — and on a
 * record being created that meant losing everything typed so far. So the list
 * now ends in a create action that opens the side panel over the form, and the
 * row that comes back out of it is selected without a second trip through the
 * picker.
 *
 * Three things have to hold, and each of them was a way to get this wrong:
 * the offer is only made when the user could actually insert into the target;
 * the search that found nothing seeds the new row's name; and the selection
 * happens when the panel *saves*, from the panel's own callback, not when the
 * picker guesses the panel is finished.
 */

let canCreateResult = true;
const sidePanelOpen = jest.fn();

jest.mock("../../src/hooks/useSidePanel", () => ({
    useSidePanel: () => ({
        open: sidePanelOpen,
        close: jest.fn(),
        replace: jest.fn()
    })
}));

jest.mock("../../src/components/EntityPreviewBinding", () => ({
    EntityPreviewBindingData: ({ entity }: { entity: { id: string | number } }) =>
        <div data-testid="preview">{String(entity.id)}</div>,
    EntityPreviewContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

jest.mock("@rebasepro/app", () => ({
    useData: () => ({
        collection: () => ({
            find: async () => ({ data: [],
meta: { hasMore: false } })
        })
    }),
    usePermissions: () => ({ canCreate: () => canCreateResult }),
    // Echoes the key and the interpolated name, so a label can be asserted
    // without pinning the English copy.
    useTranslation: () => ({
        t: (key: string, options?: { name?: string }) => options?.name ? `${key}:${options.name}` : key
    }),
    useRelationSelector: () => ({
        items: [],
        isLoading: false,
        hasMore: false,
        error: undefined,
        search: () => undefined,
        loadMore: () => undefined,
        entityToRelationItem: (entity: any, relation: any) => ({
            id: entity.id,
            label: String(entity.values?.name ?? entity.id),
            data: entity,
            relation
        })
    }),
    getTitlePropertyKey: () => "name"
}));

import { RelationSelector } from "../../src/components/RelationSelector";

beforeAll(() => {
    // cmdk observes its own list; jsdom has no ResizeObserver.
    (globalThis as Record<string, unknown>).ResizeObserver = class {
        observe() { /* no layout in jsdom */ }
        unobserve() { /* no layout in jsdom */ }
        disconnect() { /* no layout in jsdom */ }
    };
    // Radix needs pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

function buildRelation(titleProperty: Record<string, unknown> = { type: "string",
name: "Name" }): Relation {
    const collection = {
        slug: "companies",
        name: "Companies",
        singularName: "Company",
        properties: { name: titleProperty }
    };
    return {
        kind: "belongsTo",
        cardinality: "one",
        target: () => collection
    } as unknown as Relation;
}

/** The to-many arm: same picker, and the created row joins the selection. */
function buildManyRelation(): Relation {
    return {
        ...buildRelation(),
        kind: "manyToMany",
        cardinality: "many"
    } as unknown as Relation;
}

function openPicker() {
    fireEvent.click(screen.getByRole("button", { name: /select/i }));
}

describe("creating the target row from the relation picker", () => {

    beforeEach(() => {
        canCreateResult = true;
        sidePanelOpen.mockClear();
    });

    it("offers to create a row in the target collection", () => {
        render(<RelationSelector relation={buildRelation()}/>);
        openPicker();
        expect(screen.getByText("add_specific:Company")).toBeTruthy();
    });

    it("makes no offer when the user cannot insert into the target", () => {
        canCreateResult = false;
        render(<RelationSelector relation={buildRelation()}/>);
        openPicker();
        expect(screen.queryByText("add_specific:Company")).toBeNull();
    });

    it("makes no offer when the caller turned it off", () => {
        render(<RelationSelector relation={buildRelation()} allowCreate={false}/>);
        openPicker();
        expect(screen.queryByText("add_specific:Company")).toBeNull();
    });

    it("opens the side panel on the target collection, closing when it saves", () => {
        render(<RelationSelector relation={buildRelation()}/>);
        openPicker();
        fireEvent.click(screen.getByText("add_specific:Company"));

        expect(sidePanelOpen).toHaveBeenCalledTimes(1);
        const props = sidePanelOpen.mock.calls[0][0] as Record<string, unknown>;
        expect(props.path).toBe("companies");
        expect(props.closeOnSave).toBe(true);
        expect((props.collection as { slug: string }).slug).toBe("companies");
    });

    it("does not push a URL for the detour", () => {
        // Reported from the running panel: with `updateUrl: true`, closing the
        // create form is a *pathname* change, and that is precisely what
        // `useUnsavedChangesDialog` blocks on. Saving the new row then raced
        // the panel clearing its own dirty flag — often losing, and answering a
        // successful save with "There are unsaved changes" while the URL stayed
        // stranded on the target collection. Not a race worth winning: the
        // address of a record that does not exist yet restores nothing.
        render(<RelationSelector relation={buildRelation()}/>);
        openPicker();
        fireEvent.click(screen.getByText("add_specific:Company"));

        const props = sidePanelOpen.mock.calls[0][0] as Record<string, unknown>;
        expect(props.updateUrl).toBe(false);
    });

    it("seeds the new row with the search that found nothing", () => {
        render(<RelationSelector relation={buildRelation()}/>);
        openPicker();
        fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "  EDU.MX  " } });
        fireEvent.click(screen.getByText("add_named:EDU.MX"));

        const props = sidePanelOpen.mock.calls[0][0] as Record<string, unknown>;
        expect(props.defaultValues).toEqual({ name: "EDU.MX" });
    });

    it("seeds nothing when the title property could not hold free text", () => {
        // An enum is a closed set: dropping a search string into it produces a
        // value the property does not have.
        render(<RelationSelector relation={buildRelation({ type: "string",
enum: { a: "A" } })}/>);
        openPicker();
        fireEvent.change(screen.getByPlaceholderText("Search..."), { target: { value: "EDU.MX" } });
        fireEvent.click(screen.getByText("add_named:EDU.MX"));

        const props = sidePanelOpen.mock.calls[0][0] as Record<string, unknown>;
        expect(props.defaultValues).toBeUndefined();
    });

    it("selects the row the side panel saved", () => {
        const onValueChange = jest.fn();
        render(<RelationSelector relation={buildRelation()} onValueChange={onValueChange}/>);
        openPicker();
        fireEvent.click(screen.getByText("add_specific:Company"));

        expect(onValueChange).not.toHaveBeenCalled();

        const props = sidePanelOpen.mock.calls[0][0] as { onUpdate: (p: unknown) => void };
        act(() => props.onUpdate({
            entity: { id: 42,
path: "companies",
values: { name: "EDU.MX" } },
            status: "new",
            path: "companies"
        }));

        expect(onValueChange).toHaveBeenCalledTimes(1);
        const emitted = onValueChange.mock.calls[0][0] as { id: string | number, path: string };
        expect(emitted.id).toBe(42);
        expect(emitted.path).toBe("companies");
    });

    it("adds the saved row to what a to-many relation already holds", () => {
        // The one line that differs between the two arms: a to-many picker
        // appends, and replacing there would silently drop every tag already
        // on the record.
        const onValueChange = jest.fn();
        // Carrying its data, so the selector resolves it on the spot rather
        // than going out to fetch it and rendering "Loading…" instead.
        const existing = new EntityRelation(7, "companies", { id: 7,
path: "companies",
values: { name: "Acme" } });
        render(<RelationSelector relation={buildManyRelation()}
            value={[existing]}
            onValueChange={onValueChange}/>);
        // Not `openPicker`: the trigger is named after what is selected, not
        // "Select…", once the field holds something.
        fireEvent.click(document.querySelector("[data-relation-selector-trigger]")!);
        fireEvent.click(screen.getByText("add_specific:Company"));

        const props = sidePanelOpen.mock.calls[0][0] as { onUpdate: (p: unknown) => void };
        act(() => props.onUpdate({
            entity: { id: 42,
path: "companies",
values: { name: "EDU.MX" } },
            status: "new",
            path: "companies"
        }));

        const emitted = onValueChange.mock.calls[0][0] as { id: string | number }[];
        expect(emitted.map(r => r.id)).toEqual([7, 42]);
    });
});
