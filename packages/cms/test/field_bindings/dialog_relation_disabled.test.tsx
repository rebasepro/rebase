/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * The relation and reference fields that pick through a dialog
 * (`widget: "dialog"`, and every reference) honoured `disabled` only in how
 * they looked. The picker still opened from the empty state, and the
 * many-valued ones kept their "Edit" button and their reordering live — so a
 * field declared `admin.disabled` could be changed and saved. Their empty
 * state also read "EDIT UNDEFINED" for a property with no `name`.
 */

const openDialog = jest.fn();

jest.mock("../../src/hooks/useSelectionDialog", () => ({
    useEntitySelectionDialog: () => ({ open: openDialog, close: () => undefined })
}));

const authors: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    table: "authors",
    properties: { name: { name: "Name", type: "string" } }
};

jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getCollection: () => authors,
        resolveCollectionPath: (path: string) => path,
        resolveDataPath: (path: string) => path
    })
}));

import { RebaseI18nProvider } from "@rebasepro/app";
import type { ArrayProperty, CollectionConfig, EntityReference, Property, ReferenceProperty, RelationProperty } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import type { FieldProps } from "../../src/types/fields";
import { fakeFieldProps, fakeFormContext } from "../helpers/fakes";
import { RelationFieldBinding } from "../../src/form/field_bindings/RelationFieldBinding";
import { ReferenceFieldBinding } from "../../src/form/field_bindings/ReferenceFieldBinding";
import { ArrayOfReferencesFieldBinding } from "../../src/form/field_bindings/ArrayOfReferencesFieldBinding";

const posts: AdminCollection = { slug: "posts", name: "Posts", table: "posts", properties: {} };

function fieldProps<P extends Property, C = unknown>(property: P, overrides: Partial<FieldProps<P, C>> = {}): FieldProps<P, C> {
    return fakeFieldProps(property, {
        propertyKey: "author",
        showError: false,
        disabled: false,
        isSubmitting: false,
        autoFocus: false,
        touched: false,
        includeDescription: false,
        partOfArray: false,
        minimalistView: false,
        context: fakeFormContext({}, { collection: posts }),
        ...overrides
    });
}

const singleRelation: RelationProperty = {
    type: "relation",
    relation: { kind: "belongsTo", target: () => authors },
    admin: { widget: "dialog" }
};

const manyRelation: RelationProperty = {
    type: "relation",
    name: "Authors",
    relation: { kind: "manyToMany", target: () => authors },
    admin: { widget: "dialog" }
};

const reference: ReferenceProperty = { type: "reference", path: "authors" };

const references: ArrayProperty = { type: "array", name: "Authors", of: { type: "reference", path: "authors" } };

function renderField(element: React.ReactElement) {
    return render(<RebaseI18nProvider locale={"en"}>{element}</RebaseI18nProvider>);
}

describe("dialog-picked relation and reference fields", () => {

    beforeEach(() => {
        openDialog.mockClear();
    });

    it("an empty single relation opens its picker when enabled", () => {
        renderField(<RelationFieldBinding {...fieldProps(singleRelation)}/>);
        fireEvent.click(screen.getByText(/edit author/i));
        expect(openDialog).toHaveBeenCalledTimes(1);
    });

    it("an empty single relation does not open its picker when disabled", () => {
        renderField(<RelationFieldBinding {...fieldProps(singleRelation, { disabled: true })}/>);
        fireEvent.click(screen.getByText(/edit author/i));
        expect(openDialog).not.toHaveBeenCalled();
    });

    it("names an unnamed property by its key, not `undefined`", () => {
        renderField(<RelationFieldBinding {...fieldProps(singleRelation)}/>);
        expect(screen.queryByText(/undefined/i)).toBeNull();
    });

    it("an empty reference does not open its picker when disabled", () => {
        renderField(<ReferenceFieldBinding {...fieldProps(reference, { disabled: true })}/>);
        fireEvent.click(screen.getByText(/edit author/i));
        expect(openDialog).not.toHaveBeenCalled();
        expect(screen.queryByText(/undefined/i)).toBeNull();
    });

    it("a many relation's Edit button is disabled when the field is", () => {
        renderField(<RelationFieldBinding {...fieldProps(manyRelation, { value: [], disabled: true })}/>);
        const edit = screen.getByRole("button", { name: /edit authors/i });
        expect(edit.hasAttribute("disabled")).toBe(true);
        fireEvent.click(edit);
        expect(openDialog).not.toHaveBeenCalled();
    });

    it("an array of references' Edit button is disabled when the field is", () => {
        renderField(<ArrayOfReferencesFieldBinding {...fieldProps<ArrayProperty, EntityReference[]>(references, { value: [], disabled: true })}/>);
        const edit = screen.getByRole("button", { name: /edit authors/i });
        expect(edit.hasAttribute("disabled")).toBe(true);
        fireEvent.click(edit);
        expect(openDialog).not.toHaveBeenCalled();
    });

});
