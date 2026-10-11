/**
 * @jest-environment jsdom
 */
/**
 * The collection export writes a CSV a page at a time.
 *
 * It used to read every page into memory, then compute every row's
 * additional columns, then build the file — ~211 MB held at the peak for
 * 100,000 rows × 20 columns. Each page is now written (additional columns
 * included) before the next one is read, so what the export holds is the file
 * and one page. JSON still builds in memory: it is one `JSON.stringify`.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";

type Row = Record<string, unknown>;

// What happened, in order: a page read, a row's additional column computed.
const mockEvents: string[] = [];
const PAGES: Entity<Row>[][] = [0, 1, 2].map(page => [0, 1].map(i => ({
    id: `p${page}r${i}`,
    path: "items",
    values: { name: `Row ${page}.${i}`, tags: page === 2 && i === 1 ? ["a", "b", "c"] : ["x"] }
})));

const mockAccessor = {
    find: jest.fn(async (params?: { after?: string }) => {
        const index = params?.after ? Number(params.after) : 0;
        mockEvents.push(`find ${index}`);
        return {
            data: PAGES[index],
            meta: { total: 6, hasMore: index < PAGES.length - 1, nextCursor: String(index + 1) }
        };
    })
};

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useData: () => ({ collection: () => mockAccessor }),
        useRebaseContext: () => ({}),
        useAuthController: () => ({ user: { uid: "u1", roles: ["admin"] } }),
        useCustomizationController: () => ({ plugins: [], propertyConfigs: {}, entityActions: [], entityViews: [], resolvedSlots: [] })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

jest.mock("../../src/hooks/useAdminContext", () => ({
    useAdminContext: () => ({})
}));

import { RebaseI18nProvider } from "@rebasepro/app";
import { ExportCollectionAction } from "../../src/data_export/export/ExportCollectionAction";
import { downloadEntitiesExport } from "../../src/data_export/export/export";

const collection = {
    slug: "items",
    name: "Items",
    properties: { name: { type: "string" }, tags: { type: "array", of: { type: "string" } } },
    additionalFields: [{
        key: "shout",
        name: "Shout",
        value: ({ entity }: { entity: Entity<Row> }) => {
            mockEvents.push(`value ${entity.id}`);
            return String(entity.values.name).toUpperCase();
        }
    }]
};

let blobs: Blob[] = [];
const originalCreateObjectURL = URL.createObjectURL;

function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blob);
    });
}

async function exportAs(format: "CSV" | "JSON"): Promise<string> {
    render(<RebaseI18nProvider locale="en">
        <ExportCollectionAction
            collection={collection as never}
            path="items"
            relativePath="items"
            parentCollectionSlugs={[]}
            parentEntityIds={[]}
            context={{} as never}
            openNewDocument={() => undefined}
            collectionEntitiesCount={6}
            tableController={{} as never}
            selectionController={undefined as never}/>
    </RebaseI18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    if (format === "JSON") fireEvent.click(screen.getByRole("radio", { name: /json/i }));
    await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: /download/i }));
        await new Promise(r => setTimeout(r, 0));
    });
    expect(blobs).toHaveLength(1);
    return readBlob(blobs[0]);
}

describe("the collection export", () => {

    beforeEach(() => {
        mockEvents.length = 0;
        blobs = [];
        URL.createObjectURL = jest.fn((blob: Blob) => {
            blobs.push(blob);
            return "blob:test";
        });
        URL.revokeObjectURL = jest.fn();
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    });

    afterEach(() => {
        URL.createObjectURL = originalCreateObjectURL;
        jest.restoreAllMocks();
    });

    it("writes each page of a CSV before reading the next", async () => {
        await exportAs("CSV");
        expect(mockEvents).toEqual([
            "find 0", "value p0r0", "value p0r1",
            "find 1", "value p1r0", "value p1r1",
            "find 2", "value p2r0", "value p2r1"
        ]);
    });

    it("writes the CSV the in-memory export wrote, arrays spread by the longest one in any page", async () => {
        const csv = await exportAs("CSV");

        let expected: Blob | undefined;
        URL.createObjectURL = jest.fn((blob: Blob) => {
            expected = blob;
            return "blob:expected";
        });
        const rows = PAGES.flat();
        downloadEntitiesExport({
            data: rows,
            additionalData: rows.map(row => ({ shout: String(row.values.name).toUpperCase() })),
            properties: collection.properties as never,
            propertiesOrder: undefined,
            name: "Items",
            flattenArrays: true,
            additionalHeaders: ["shout"],
            exportType: "csv",
            dateExportType: "string"
        });
        expect(csv).toBe(await readBlob(expected!));
        expect(csv.split("\r\n")[0]).toBe("\"id\",\"name\",\"tags[0]\",\"tags[1]\",\"tags[2]\",\"shout\"");
        expect(csv).toContain("\"p0r0\",\"Row 0.0\",\"x\",,,\"ROW 0.0\"\r\n");
    });

    it("still builds JSON in one piece", async () => {
        const json = await exportAs("JSON");
        expect(mockEvents.slice(0, 3)).toEqual(["find 0", "find 1", "find 2"]);
        expect(JSON.parse(json)).toHaveLength(6);
    });
});
