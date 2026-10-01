/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { en } from "../../../app/src/locales/en";

/** The English bundle, interpolated as i18next does. */
function t(key: string, options?: Record<string, unknown>): string {
    const template = (en as unknown as Record<string, string>)[key] ?? key;
    return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ""));
}

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = { useTranslation: () => ({ t }) };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { ImportConversionProblems } from "../../src/data_import/components/ImportConversionProblems";
import { convertImportData } from "../../src/data_import/utils/data";
import { loadFixture } from "./fixtures/pipeline";

/**
 * The preview names every cell the import leaves out — how many per column,
 * and the first few with their row and why — before the person importing
 * presses Save.
 */
describe("ImportConversionProblems", () => {
    it("lists the cells of a number column that are not numbers", () => {
        const { data } = loadFixture("a_numeric_na.csv");
        const { problems } = convertImportData({} as never, { getCollection: () => undefined } as never, data,
            undefined, { sku: "sku", price: "price", stock: "stock" },
            { sku: { type: "string" }, price: { type: "number" }, stock: { type: "number" } }, "TEMP_PATH", {});

        render(<ImportConversionProblems problems={problems}/>);

        expect(screen.getByText("Values that cannot be imported: 2")).toBeTruthy();
        expect(screen.getByText("price → price (number): 2 not imported")).toBeTruthy();
        expect(screen.getByText("Row 2: “N/A”, not a number")).toBeTruthy();
        expect(screen.getByText("Row 4: “-”, not a number")).toBeTruthy();
    });

    it("says nothing when every cell converts", () => {
        const { container } = render(<ImportConversionProblems problems={[]}/>);
        expect(container.textContent).toBe("");
    });
});
