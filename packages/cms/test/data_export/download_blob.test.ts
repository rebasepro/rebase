/**
 * @jest-environment jsdom
 */
/**
 * An export's file is let go once the browser has it.
 *
 * `downloadBlob` created an object URL for every export and never revoked it,
 * so each export's whole file — 32 MB of CSV or 55 MB of JSON at 100k × 20 —
 * stayed in memory until the tab was closed.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { downloadBlob } from "../../src/data_export/export/export";

describe("downloadBlob", () => {

    const created: string[] = [];
    const revoked: string[] = [];

    beforeEach(() => {
        jest.useFakeTimers();
        created.length = 0;
        revoked.length = 0;
        let n = 0;
        Object.assign(URL, {
            createObjectURL: () => {
                const url = "blob:export-" + (n++);
                created.push(url);
                return url;
            },
            revokeObjectURL: (url: string) => {
                revoked.push(url);
            }
        });
        jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test("revokes the URL it created once the download has started", () => {
        downloadBlob(["a,b\r\n"], "one.csv", "text/csv");
        downloadBlob(["c,d\r\n"], "two.csv", "text/csv");
        expect(created).toHaveLength(2);

        jest.runAllTimers();

        expect(revoked).toEqual(created);
    });
});
