/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A `via` relation is read-only (`writable: false`): the server refuses a write
 * naming one with RELATION_NOT_WRITABLE, on every door. The form offered its
 * picker anyway, so choosing a row there could only end in that refusal on
 * save. The field shows its value and does not open a picker.
 */

const openDialog = jest.fn();

jest.mock("../../src/hooks/useSelectionDialog", () => ({
    useSelectionDialog: () => ({ open: openDialog, close: () => undefined })
}));

const badges = {
    slug: "badges",
    name: "Badges",
    table: "badges",
    properties: { label: { name: "Label", type: "string" } }
};

jest.mock("../../src/hooks/navigation/contexts/CollectionRegistryContext", () => ({
    useCollectionRegistryController: () => ({
        getCollection: () => badges,
        resolveCollectionPath: (path: string) => path,
        resolveDataPath: (path: string) => path
    })
}));

import { RebaseI18nProvider } from "@rebasepro/app";
import { RelationFieldBinding } from "../../src/form/field_bindings/RelationFieldBinding";

const authors = { slug: "authors", name: "Authors", table: "authors", properties: {} };

function fieldProps(property: unknown) {
    return {
        propertyKey: "badge",
        property,
        value: null,
        setValue: () => undefined,
        setFieldValue: () => undefined,
        error: undefined,
        showError: false,
        disabled: false,
        isSubmitting: false,
        autoFocus: false,
        touched: false,
        includeDescription: false,
        partOfArray: false,
        minimalistView: false,
        context: { collection: authors, values: {}, formex: { version: 0 } }
    } as never;
}

const via = {
    type: "relation",
    relation: {
        kind: "via",
        cardinality: "one",
        target: () => badges,
        joinPath: [{ table: "badges", on: { from: "id", to: "owner_id" } }]
    },
    admin: { widget: "dialog" }
};

const belongsTo = {
    type: "relation",
    relation: { kind: "belongsTo", target: () => badges },
    admin: { widget: "dialog" }
};

function renderField(property: unknown) {
    return render(<RebaseI18nProvider locale={"en"}><RelationFieldBinding {...fieldProps(property)}/></RebaseI18nProvider>);
}

describe("a via relation in the form", () => {
    beforeEach(() => openDialog.mockClear());

    it("does not open a picker", () => {
        renderField(via);
        fireEvent.click(screen.getByText(/edit badge/i));
        expect(openDialog).not.toHaveBeenCalled();
    });

    it("while a writable relation beside it still does", () => {
        renderField(belongsTo);
        fireEvent.click(screen.getByText(/edit badge/i));
        expect(openDialog).toHaveBeenCalledTimes(1);
    });
});
