import { describe, expect, it } from "@jest/globals";
import { parseCsv, parseCsvWithHeader } from "../src/utils/csv_parse";

/**
 * The Data tab's CSV import reads back what its export writes (RFC 4180,
 * NULL as an empty field), so a round trip keeps every value.
 */
describe("parseCsv", () => {
    it("reads quoted fields with commas, line breaks and doubled quotes", () => {
        expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\r\n')).toEqual([
            ["a", "b"],
            ["x, y", "say \"hi\"\nthere"]
        ]);
    });

    it("tells NULL (an empty field) from an empty string (an empty quoted field)", () => {
        expect(parseCsv('id,name\n1,\n2,""\n')).toEqual([["id", "name"], ["1", null], ["2", ""]]);
    });

    it("drops a byte order mark and a trailing line break, and keeps a last line without one", () => {
        expect(parseCsv("﻿id\n1\n2")).toEqual([["id"], ["1"], ["2"]]);
    });

    it("keys rows by the header, trimming the names", () => {
        expect(parseCsvWithHeader(" id , title\n1,Hello\n")).toEqual({
            columns: ["id", "title"],
            rows: [{ id: "1", title: "Hello" }]
        });
    });
});
