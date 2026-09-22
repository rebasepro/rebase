/**
 * @jest-environment jsdom
 */
/**
 * `entity.field.before` and `entity.field.after`, rendering around a real field.
 *
 * They render in `PropertyFieldBinding` rather than in each field binding, and
 * that choice is the thing worth pinning: a slot honoured by the string field
 * and not by the date field is worse than one that never renders at all, and
 * there are two dozen bindings. This renders the binding that all of them go
 * through and checks the slot lands on both sides of whichever component the
 * property resolved to.
 *
 * The props matter as much as the placement. `propertyKey` may be a nested name
 * (`address.street`, `friends[2]`), and it is the only way a contribution knows
 * *which* field it is decorating — a slot handed the wrong one, or handed
 * `undefined`, renders the same thing under every field on the form.
 */
import React from "react";
import { describe, expect, test, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";

const seen: Record<string, Record<string, unknown>[]> = {};

function fakeUseSlot(slot: string, props: Record<string, unknown>): React.ReactNode[] {
    (seen[slot] ??= []).push(props);
    return [<span key={slot} data-testid={`slot:${slot}`}/>];
}

/** The field the property resolves to, so the slots have something to flank. */
const TheField = () => <input data-testid="the-field"/>;

jest.mock("@rebasepro/app", () => ({
    useSlot: fakeUseSlot,
    useRebaseContext: () => ({ marker: "context" }),
    useAuthController: () => ({ user: undefined }),
    useCustomizationController: () => ({ propertyConfigs: {}, plugins: [] }),
    useTranslation: () => ({ t: (key: string) => key }),
    resolveComponentRef: (ref: unknown) => ref,
    isDisabled: () => false,
    isHidden: () => false,
    isReadOnly: () => false
}));

// `Field` wires a property key to the surrounding formex form. There is no form
// here, so it hands the render prop the one thing the binding reads off it.
jest.mock("@rebasepro/forms", () => ({
    Field: ({ children }: { children: (p: unknown) => React.ReactNode }) => children({
        field: { value: "hello" },
        form: {
            values: {}, errors: {}, touched: {}, submitCount: 0, isSubmitting: false,
            setFieldTouched: () => undefined, setFieldValue: () => undefined
        }
    }),
    getIn: () => undefined
}));

jest.mock("../../src/components/field_configs", () => ({
    getFieldConfig: () => ({ property: { type: "string", admin: { Field: TheField } } }),
    getFieldId: () => "string"
}));

import { PropertyFieldBinding } from "../../src/form/PropertyFieldBinding";

const property = { type: "string", name: "Street" } as never;

const collection = { slug: "addresses", name: "Addresses" } as never;

function renderField(propertyKey = "address.street") {
    return render(
        <PropertyFieldBinding
            propertyKey={propertyKey}
            property={property}
            context={{
                path: "addresses",
                entityId: "a1",
                collection,
                values: {},
                status: "existing",
                disabled: false
            } as never}
        />
    );
}

beforeEach(() => {
    for (const key of Object.keys(seen)) delete seen[key];
});

describe("the field slots render around every form field", () => {
    test("both are in the tree, with the field between them", () => {
        const { container } = renderField();

        expect(screen.getByTestId("the-field")).toBeTruthy();
        const order = Array.from(container.querySelectorAll("[data-testid]"))
            .map(n => n.getAttribute("data-testid"));
        expect(order).toEqual([
            "slot:entity.field.before",
            "the-field",
            "slot:entity.field.after"
        ]);
    });

    test("are told which field they are decorating, by the key the field itself uses", () => {
        renderField("friends[2]");

        for (const slot of ["entity.field.before", "entity.field.after"]) {
            expect(seen[slot][0]).toMatchObject({
                propertyKey: "friends[2]",
                property: { type: "string", name: "Street" },
                path: "addresses",
                entityId: "a1",
                collection,
                context: { marker: "context" }
            });
        }
    });

    test("get the same props, so a contribution can serve both", () => {
        renderField();
        expect(seen["entity.field.before"][0]).toEqual(seen["entity.field.after"][0]);
    });
});
