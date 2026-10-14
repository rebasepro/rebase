/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Formex, useCreateFormex } from "@rebasepro/forms";
import { RebaseI18nProvider } from "@rebasepro/app";

/**
 * The date property's mode, automatic value and timezone selects speak the
 * admin's language.
 *
 * Their labels were translated and what sat under them was not: "Date/Time",
 * "On any update", "Local timezone", and the two captions explaining them. A
 * German property editor read "Automatischer Wert" over "None".
 */

jest.mock("../../src/collection_editor/_cms_internals", () => ({
    FieldCaption: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>
}));

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

function renderInGerman(initialValues: Record<string, unknown>) {
    function Harness() {
        const formex = useCreateFormex<Record<string, unknown>>({ initialValues });
        return <Formex value={formex}><DateTimePropertyField disabled={false}/></Formex>;
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

describe("the date property's selects, in German", () => {
    it("shows the values and the captions in German", async () => {
        renderInGerman({ type: "date", mode: "date_time", autoValue: "on_update" });

        expect(await screen.findByText("Datum/Uhrzeit")).toBeTruthy();
        expect(screen.getByText("Bei jeder Aktualisierung")).toBeTruthy();
        expect(screen.getByText("Lokale Zeitzone")).toBeTruthy();
        expect(screen.getByText("Dieses Feld beim Erstellen oder Aktualisieren des Datensatzes automatisch setzen")).toBeTruthy();
        expect(screen.getByText("Zeitzone für die Anzeige und Eingabe von Datumswerten. Gespeichert wird immer in UTC.")).toBeTruthy();

        for (const english of [
            "Date/Time",
            "On any update",
            "Local timezone",
            "Update this field automatically when creating or updating the entity",
            "Timezone for displaying and inputting dates. Values are always stored in UTC."
        ]) {
            expect(screen.queryByText(english)).toBeNull();
        }
    });

    it("says no automatic value in German", async () => {
        renderInGerman({ type: "date" });
        expect(await screen.findByText("Keiner")).toBeTruthy();
        expect(screen.getByText("Datum")).toBeTruthy();
        expect(screen.queryByText("None")).toBeNull();
    });

    it("offers the modes and the automatic values in German", async () => {
        renderInGerman({ type: "date" });
        await screen.findByText("Keiner");

        expect(await optionsOf("Modus")).toEqual(["Datum/Uhrzeit", "Datum"]);
        expect(await optionsOf("Automatischer Wert")).toEqual(["Keiner", "Beim Erstellen", "Bei jeder Aktualisierung"]);
        expect((await optionsOf("Zeitzone"))[0]).toBe("Lokale Zeitzone");
    });
});
