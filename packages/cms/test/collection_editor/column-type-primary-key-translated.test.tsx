/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Formex, useCreateFormex } from "@rebasepro/forms";
import { RebaseI18nProvider } from "@rebasepro/app";

/**
 * Studio's column-type and primary-key selects speak the admin's language.
 *
 * Their labels were translated and everything under them was not: each option
 * ("varchar (variable length)", "Yes (Manual input)"), the value the closed
 * select shows, and the caption under it. A German property editor read
 * "Datenbank-Spaltentyp" over "Default (text)" and "Optional database override
 * for this string field." The SQL type names themselves are code and stay.
 */

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

import { StringPropertyField } from "../../src/collection_editor/ui/collection_editor/properties/StringPropertyField";
import { NumberPropertyField } from "../../src/collection_editor/ui/collection_editor/properties/NumberPropertyField";
import { DateTimePropertyField } from "../../src/collection_editor/ui/collection_editor/properties/DateTimePropertyField";

beforeAll(() => {
    class NoopResizeObserver {
        observe() { /* noop */ }
        unobserve() { /* noop */ }
        disconnect() { /* noop */ }
    }
    Object.assign(globalThis, { ResizeObserver: NoopResizeObserver });
    Object.assign(Element.prototype, {
        scrollIntoView: () => undefined,
        hasPointerCapture: () => false,
        releasePointerCapture: () => undefined
    });
});

function renderInGerman(field: React.ReactElement, initialValues: Record<string, unknown>) {
    function Harness() {
        const formex = useCreateFormex<Record<string, unknown>>({ initialValues });
        return <Formex value={formex}>{field}</Formex>;
    }
    return render(<RebaseI18nProvider locale="de"><Harness/></RebaseI18nProvider>);
}

/** Open the select named `label` and return the text of its options. */
async function optionsOf(label: string): Promise<string[]> {
    const trigger = screen.getByRole("combobox", { name: label });
    await act(async () => {
        fireEvent.keyDown(trigger, { key: "ArrowDown" });
    });
    const options = screen.getAllByRole("option").map(option => option.textContent?.trim() ?? "");
    await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    return options;
}

describe("the string property's column type and primary key, in German", () => {
    it("shows the values and the captions in German", async () => {
        renderInGerman(<StringPropertyField widgetId="text_field" disabled={false} showErrors={false}/>, { type: "string" });

        expect(await screen.findByText("Standard (text)")).toBeTruthy();
        expect(screen.getByText("Optional: abweichender Datenbank-Spaltentyp für dieses Textfeld.")).toBeTruthy();
        expect(screen.getByText("Nein")).toBeTruthy();
        expect(screen.getByText("Als Primärschlüssel festlegen und die Strategie zur ID-Erzeugung einstellen.")).toBeTruthy();

        expect(screen.queryByText("Default (text)")).toBeNull();
        expect(screen.queryByText("Optional database override for this string field.")).toBeNull();
        expect(screen.queryByText("Set as Primary Key and configure ID generation strategy.")).toBeNull();
    });

    it("offers the column types in German", async () => {
        renderInGerman(<StringPropertyField widgetId="text_field" disabled={false} showErrors={false}/>, { type: "string" });
        await screen.findByText("Standard (text)");

        expect(await optionsOf("Datenbank-Spaltentyp")).toEqual([
            "Standard (text)",
            "varchar (variable Länge)",
            "text (unbegrenzt)",
            "char (feste Länge)"
        ]);
    });

    it("offers the id strategies in German", async () => {
        renderInGerman(<StringPropertyField widgetId="text_field" disabled={false} showErrors={false}/>, { type: "string" });
        await screen.findByText("Standard (text)");

        expect(await optionsOf("Primärschlüssel / Eindeutige ID")).toEqual([
            "Nein",
            "Ja (manuelle Eingabe)",
            "Ja (automatisch erzeugte UUID/Zeichenkette)",
            "Ja (UUID)",
            "Ja (CUID)"
        ]);
    });

    it("says a uuid key forces the column type, in German", async () => {
        renderInGerman(<StringPropertyField widgetId="text_field" disabled={false} showErrors={false}/>, { type: "string", isId: "uuid" });

        expect((await screen.findAllByText("uuid (durch den Primärschlüssel vorgegeben)")).length).toBeGreaterThan(0);
        expect(screen.getByText("Ja (UUID)")).toBeTruthy();
        expect(screen.queryByText("uuid (forced by Primary Key)")).toBeNull();
    });
});

describe("the number property's column type and primary key, in German", () => {
    it("shows its value, options and captions in German", async () => {
        renderInGerman(<NumberPropertyField disabled={false}/>, { type: "number", isId: true });

        expect(await screen.findByText("Standard (integer/numeric)")).toBeTruthy();
        expect(screen.getByText("Optional: abweichender Datenbank-Spaltentyp für dieses Zahlenfeld.")).toBeTruthy();
        expect(screen.getByText("Ja (Auto-Inkrement/Identity)")).toBeTruthy();

        expect(await optionsOf("Primärschlüssel / Eindeutige ID")).toEqual([
            "Nein",
            "Ja (manuelle Eingabe)",
            "Ja (Auto-Inkrement/Identity)",
            "Ja (Inkrement)"
        ]);
        expect(screen.queryByText("Optional database override for this number field.")).toBeNull();
    });
});

describe("the date property's column type, in German", () => {
    it("shows its value, options and caption in German", async () => {
        renderInGerman(<DateTimePropertyField disabled={false}/>, { type: "date" });

        expect(await screen.findByText("Standard (timestamp)")).toBeTruthy();
        expect(screen.getByText("Optional: abweichender Datenbank-Spaltentyp für dieses Datumsfeld.")).toBeTruthy();

        expect(await optionsOf("Datenbank-Spaltentyp")).toEqual([
            "Standard (timestamp)",
            "timestamp (mit Zeitzone)",
            "date",
            "time"
        ]);
        expect(screen.queryByText("Default (timestamp)")).toBeNull();
    });
});
