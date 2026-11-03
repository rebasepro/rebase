/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Formex, FormexController, useCreateFormex } from "@rebasepro/forms";

/**
 * A number select's values in the collection editor.
 *
 * `0` is an id: a truthiness check left it out of the default value select
 * and flagged its entry as having none. A default picked from the select is
 * the enum's own id — the select's values are text, and the default was
 * written as `"1"`, which the next edit of any value did not find among the
 * ids `[0, 1]`, so it cleared the default and warned that it had.
 */

const mockSnackbar = { open: jest.fn() };
jest.mock("../../src/collection_editor/useSafeSnackbarController", () => ({
    useSafeSnackbarController: () => mockSnackbar
}));

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

import { EnumPropertyField } from "../../src/collection_editor/ui/collection_editor/properties/EnumPropertyField";
import { hasEnumId } from "../../src/collection_editor/ui/collection_editor/EnumForm";

beforeAll(() => {
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

type Values = Record<string, unknown>;

function Harness({ initialValues, onController }: {
    initialValues: Values,
    onController: (controller: FormexController<Values>) => void
}) {
    const formex = useCreateFormex<Values>({ initialValues });
    onController(formex);
    return <Formex value={formex}>
        <EnumPropertyField multiselect={false}
            updateIds={false}
            disabled={false}
            showErrors={true}/>
    </Formex>;
}

describe("number select in the collection editor", () => {
    const priority = {
        id: "priority",
        name: "Priority",
        type: "number",
        enum: [{ id: 0, label: "None" }, { id: 1, label: "Low" }, { id: 2, label: "High" }]
    };

    it("reads 0 as an id", () => {
        expect(hasEnumId({ id: 0, label: "None" })).toBe(true);
        expect(hasEnumId({ id: "", label: "Blank" })).toBe(false);
    });

    it("offers 0 as a default, and writes the default as the enum's number id", async () => {
        let controller: FormexController<Values> | undefined;
        render(<Harness initialValues={priority} onController={(c) => { controller = c; }}/>);

        const defaultSelect = screen.getAllByRole("combobox").at(-1)!;
        fireEvent.click(defaultSelect);
        fireEvent.keyDown(defaultSelect, { key: "Enter" });
        expect(screen.getByRole("option", { name: "None" })).toBeTruthy();
        fireEvent.click(screen.getByRole("option", { name: "Low" }));

        expect(controller!.values.defaultValue).toBe(1);
    });

    it("keeps a default written as text when the values change", async () => {
        let controller: FormexController<Values> | undefined;
        render(<Harness initialValues={{ ...priority, defaultValue: "1" }} onController={(c) => { controller = c; }}/>);
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(controller!.values.defaultValue).toBe("1");
        expect(mockSnackbar.open).not.toHaveBeenCalled();
    });
});
