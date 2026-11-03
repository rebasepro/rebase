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
import { useCreateFormex } from "@rebasepro/forms";
import type { MapProperty } from "@rebasepro/types";
import type { FormContext } from "../../src/types/fields";
import { KeyValueFieldBinding } from "../../src/form/field_bindings/KeyValueFieldBinding";

/**
 * Choosing the type of a key-value row that has no key yet wrote
 * `{ "": <default> }` into the value, so a record saved before the key was
 * named stored an entry under the empty key. The type is the row's until the
 * key is named.
 */
const property: MapProperty = { type: "map", name: "Attributes", keyValue: true };

type Row = Record<string, unknown>;

function Field({ value, setValue }: { value: Record<string, unknown>; setValue: (v: unknown) => void }) {
    const formex = useCreateFormex<Row>({ initialValues: { attrs: value }, onSubmit: () => undefined });
    const context: FormContext<Row> = {
        values: formex.values,
        setFieldValue: formex.setFieldValue,
        save: () => undefined,
        submit: () => undefined,
        status: "existing",
        formex,
        disabled: false
    };
    return <RebaseI18nProvider locale="en">
        <KeyValueFieldBinding
            propertyKey="attrs"
            property={property}
            value={value}
            setValue={setValue}
            setFieldValue={() => undefined}
            error={undefined}
            showError={false}
            disabled={false}
            touched={false}
            isSubmitting={false}
            includeDescription={false}
            minimalistView={true}
            context={context}/>
    </RebaseI18nProvider>;
}

describe("key-value type of an unnamed row", () => {
    it("is kept on the row and not written into the value", async () => {
        const writes: unknown[] = [];
        render(<Field value={{ color: "red" }} setValue={(v) => writes.push(v)}/>);

        await act(async () => {
            fireEvent.click(screen.getByRole("button", { name: /add/i }));
        });
        const typeMenus = screen.getAllByRole("button", { name: "Change type" });
        expect(typeMenus).toHaveLength(2);

        await act(async () => {
            // jsdom has no PointerEvent, so the menu is opened from the keyboard.
            fireEvent.keyDown(typeMenus[1], { key: "Enter" });
        });
        await act(async () => {
            fireEvent.click(await screen.findByRole("menuitem", { name: "number" }));
        });

        expect(writes.filter(w => typeof w === "object" && w !== null && "" in w)).toEqual([]);
    });
});
