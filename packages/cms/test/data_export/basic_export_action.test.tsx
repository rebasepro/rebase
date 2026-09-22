/**
 * @jest-environment jsdom
 *
 * `BasicExportAction` downloads what its dialog says.
 *
 * Its download handler was a `useCallback` with no dependencies, so it kept the
 * first render's options and rows: choosing JSON or timestamp dates still gave a
 * CSV with string dates, built from the data the button first rendered with. It
 * also passed the name `export.csv` to a writer that appends the extension, so
 * the file was `export.csv.csv`.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity, Properties } from "@rebasepro/types";
import { RebaseI18nProvider } from "@rebasepro/app";
import { BasicExportAction } from "../../src/data_export/export/BasicExportAction";

const properties: Properties = {
    name: { type: "string" },
    createdAt: { type: "date" }
};

const createdAt = new Date("2026-03-15T10:30:00.000Z");

const rowsA: Entity<Record<string, unknown>>[] = [
    { id: "1", path: "people", values: { name: "Ada", createdAt } }
];
const rowsB: Entity<Record<string, unknown>>[] = [
    { id: "2", path: "people", values: { name: "Bob", createdAt } }
];

type Download = { blob: Blob; filename: string | null };

let downloads: Download[] = [];
let pendingBlob: Blob | undefined;
const originalCreateObjectURL = URL.createObjectURL;

function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(blob);
    });
}

function renderAction(data: Entity<Record<string, unknown>>[]) {
    const view = (rows: Entity<Record<string, unknown>>[]) =>
        <RebaseI18nProvider locale="en">
            <BasicExportAction data={rows} properties={properties} propertiesOrder={["name", "createdAt"]}/>
        </RebaseI18nProvider>;
    const result = render(view(data));
    return { ...result, rerenderWith: (rows: Entity<Record<string, unknown>>[]) => result.rerender(view(rows)) };
}

function openDialog() {
    // The only button on the page before the dialog opens is the icon button.
    fireEvent.click(screen.getByRole("button"));
}

async function download(): Promise<Download> {
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /download/i }));
    });
    expect(downloads).toHaveLength(1);
    return downloads[0];
}

describe("BasicExportAction", () => {

    beforeEach(() => {
        downloads = [];
        pendingBlob = undefined;
        URL.createObjectURL = jest.fn((blob: Blob) => {
            pendingBlob = blob;
            return "blob:test";
        });
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            if (pendingBlob) downloads.push({ blob: pendingBlob, filename: this.getAttribute("download") });
        });
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL;
        jest.restoreAllMocks();
    });

    it("names the CSV file once, with one extension", async () => {
        renderAction(rowsA);
        openDialog();

        const { blob, filename } = await download();

        expect(filename).toEqual("export.csv");
        expect(blob.type).toEqual("text/csv");
    });

    it("downloads JSON when JSON is chosen", async () => {
        renderAction(rowsA);
        openDialog();
        fireEvent.click(screen.getByRole("radio", { name: /json/i }));

        const { blob, filename } = await download();

        expect(filename).toEqual("export.json");
        expect(blob.type).toEqual("application/json");
        expect(JSON.parse(await readBlob(blob))).toEqual([
            { id: "1", name: "Ada", createdAt: createdAt.toISOString() }
        ]);
    });

    it("writes dates as timestamps when timestamps are chosen", async () => {
        renderAction(rowsA);
        openDialog();
        fireEvent.click(screen.getByRole("radio", { name: /timestamp/i }));

        const { blob } = await download();

        expect(await readBlob(blob)).toContain(`"${createdAt.getTime()}"`);
    });

    it("exports the rows it was last rendered with", async () => {
        const { rerenderWith } = renderAction(rowsA);
        rerenderWith(rowsB);
        openDialog();

        const { blob } = await download();
        const text = await readBlob(blob);

        expect(text).toContain("\"Bob\"");
        expect(text).not.toContain("\"Ada\"");
    });
});
