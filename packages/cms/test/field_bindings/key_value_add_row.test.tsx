/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, locale: "en" })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { RebaseI18nProvider } from "@rebasepro/app";
import { KeyValueFieldBinding } from "../../src/form/field_bindings/KeyValueFieldBinding";

/**
 * A key-value map's "Add" wrote `{ "": null }` into the value, so a record
 * saved before the new key was named stored an entry under the empty key.
 * The new row is the form's until it has a name.
 */
const property = { type: "map", name: "Attributes", keyValue: true } as never;

function Field({ value, setValue }: { value: Record<string, unknown>; setValue: (v: unknown) => void }) {
    return <RebaseI18nProvider locale="en">
        <KeyValueFieldBinding
            propertyKey="attrs"
            property={property}
            value={value as never}
            setValue={setValue as never}
            error={undefined}
            showError={false}
            disabled={false}
            touched={false}
            isSubmitting={false}
            includeDescription={false}
            minimalistView={true}
            context={{ formex: { initialValues: { attrs: value } } } as never}/>
    </RebaseI18nProvider>;
}

describe("key-value Add", () => {
    it("adds a row without writing an empty key into the value", async () => {
        const writes: unknown[] = [];
        const view = render(<Field value={{ color: "red" }} setValue={(v) => writes.push(v)}/>);
        expect(screen.getAllByPlaceholderText("key")).toHaveLength(1);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /add/i }));
        });
        expect(screen.getAllByPlaceholderText("key")).toHaveLength(2);
        expect(writes.filter(w => typeof w === "object" && w !== null && "" in w)).toEqual([]);

        // A change to another entry keeps the unnamed row.
        await act(async () => view.rerender(<Field value={{ color: "blue" }} setValue={(v) => writes.push(v)}/>));
        expect(screen.getAllByPlaceholderText("key")).toHaveLength(2);
    });
});
