/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";

/**
 * A multi-hop `via` relation is read-only (`writable: false`): the server
 * refuses a write naming one with RELATION_NOT_WRITABLE. The form offered its
 * picker anyway, so choosing a row there could only end in that refusal on
 * save. A single-hop `via` is writable and keeps its picker.
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

const singleHop = {
    type: "relation",
    relation: {
        kind: "via",
        cardinality: "one",
        target: () => badges,
        joinPath: [{ table: "badges", on: { from: "id", to: "owner_id" } }]
    },
    admin: { widget: "dialog" }
};

const multiHop = {
    type: "relation",
    relation: {
        kind: "via",
        cardinality: "one",
        target: () => badges,
        joinPath: [
            { table: "teams", on: { from: "team_id", to: "id" } },
            { table: "badges", on: { from: "id", to: "team_id" } }
        ]
    },
    admin: { widget: "dialog" }
};

const belongsTo = {
    type: "relation",
    relation: { kind: "belongsTo", target: () => badges },
    admin: { widget: "dialog" }
};

function renderField(property: unknown) {
    const props: React.ComponentProps<typeof RelationFieldBinding> = fieldProps(property);
    return render(<RebaseI18nProvider locale={"en"}><RelationFieldBinding {...props}/></RebaseI18nProvider>);
}

describe("a via relation in the form", () => {
    beforeEach(() => {
        openDialog.mockClear();
    });

    it("does not open a picker for a multi-hop chain", () => {
        renderField(multiHop);
        fireEvent.click(screen.getByText(/edit badge/i));
        expect(openDialog).not.toHaveBeenCalled();
    });

    it("opens one for a single-hop chain, which the server writes", () => {
        renderField(singleHop);
        fireEvent.click(screen.getByText(/edit badge/i));
        expect(openDialog).toHaveBeenCalledTimes(1);
    });

    it("and for a writable relation of another kind", () => {
        renderField(belongsTo);
        fireEvent.click(screen.getByText(/edit badge/i));
        expect(openDialog).toHaveBeenCalledTimes(1);
    });
});
