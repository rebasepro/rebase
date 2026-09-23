/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Renaming a property, in the form that applies every edit as it is typed.
 *
 * The collection editor's side panel hands each change straight to the
 * collection — and a change of ID is a rename there: the property is written
 * under the new key and the old key is deleted. On a new collection the ID is
 * editable, and the panel passed no list of the other keys, so typing another
 * property's ID wrote this property over it. Nothing said so, and the other
 * property was gone.
 *
 * An ID that collides — or is not a valid ID at all — is now held back until
 * it is one, so the rename that is finally applied is from the key the
 * property really has.
 */

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    ...jest.requireActual("../../src/collection_editor/_cms_internals"),
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

import { PropertyForm, type OnPropertyChangedParams } from "../../src/collection_editor/ui/collection_editor/PropertyEditView";

class ResizeObserverStub {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

function renderForm(onPropertyChanged: (params: OnPropertyChangedParams) => void) {
    render(
        <PropertyForm
            inArray={false}
            existingProperty={false}
            autoUpdateId={false}
            autoOpenTypeSelect={false}
            allowDataInference={false}
            propertyKey={"subtitle"}
            property={{ type: "string", name: "Subtitle" }}
            existingPropertyKeys={["title", "body"]}
            onPropertyChanged={onPropertyChanged}
            propertyConfigs={{}}
        />
    );
}

function typeId(value: string) {
    const field = screen.getByLabelText(/^ID/);
    fireEvent.change(field, { target: { value } });
    // The field debounces; leaving it flushes the change at once.
    fireEvent.blur(field);
}

describe("renaming a property as it is typed", () => {
    it("does not rename it onto another property's ID", async () => {
        const changes: OnPropertyChangedParams[] = [];
        renderForm(params => changes.push(params));

        typeId("title");
        // An edit made while the ID collides is held with it, and arrives with
        // the ID once that is free — a later emission to wait for, rather than
        // an absence to hope about.
        fireEvent.change(screen.getByPlaceholderText("field_name"), { target: { value: "Sub" } });
        fireEvent.blur(screen.getByPlaceholderText("field_name"));
        typeId("headline");

        await waitFor(() => expect(changes.some(c => c.id === "headline" && c.property.name === "Sub")).toBe(true));
        expect(changes.map(c => c.id)).not.toContain("title");
    });

    it("renames it from the key it really has once the ID is free", async () => {
        const changes: OnPropertyChangedParams[] = [];
        renderForm(params => changes.push(params));

        typeId("title");
        // Held back, and said so — not only once the collection is saved.
        await waitFor(() => expect(screen.getByText("There is another field with this ID already")).toBeTruthy());
        typeId("headline");

        await waitFor(() => expect(changes.map(c => c.id)).toContain("headline"));
        expect(changes.find(c => c.id === "headline")).toMatchObject({ previousId: "subtitle" });
        expect(changes.map(c => c.id)).not.toContain("title");
    });

    it("holds back an ID that is not a valid one", async () => {
        const changes: OnPropertyChangedParams[] = [];
        renderForm(params => changes.push(params));

        typeId("sub-title");
        typeId("sub_title");

        await waitFor(() => expect(changes.map(c => c.id)).toContain("sub_title"));
        expect(changes.map(c => c.id)).not.toContain("sub-title");
        expect(changes.find(c => c.id === "sub_title")).toMatchObject({ previousId: "subtitle" });
    });
});
