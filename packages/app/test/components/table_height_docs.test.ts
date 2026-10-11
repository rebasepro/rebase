import fs from "fs";
import path from "path";
import { describe, expect, it } from "@jest/globals";
import { getRowHeight, TableSize } from "../../src/components/common/table_height";

/**
 * The view-modes page's row-height table says what `getRowHeight` returns.
 *
 * It kept the pre-2026-09-08 ladder (40 / 54 / 80 / 120 / 260, with `s` as
 * the default) for a month after the density pass changed the code to
 * 36 / 42 / 48 / 96 / 160 with `m` as the default.
 */
const page = path.resolve(__dirname, "../../../../website/src/content/docs/docs/frontend/view-modes.md");

describe("the documented row heights", () => {
    const text = fs.readFileSync(page, "utf8");
    const rows = [...text.matchAll(/^\|\s*`"(xs|s|m|l|xl)"`\s*\|\s*(\d+)\s*\|\s*([^|]*)\|/gm)];

    it("lists every size once", () => {
        expect(rows.map((row) => row[1]).sort()).toEqual(["l", "m", "s", "xl", "xs"]);
    });

    it.each(rows.map((row): [TableSize, number] => [row[1] as TableSize, Number(row[2])]))("%s is %ipx", (size, documented) => {
        expect(documented).toBe(getRowHeight(size));
    });

    it("names m, the collection default, as the default", () => {
        const defaults = rows.filter((row) => /default/i.test(row[3])).map((row) => row[1]);
        expect(defaults).toEqual(["m"]);
    });
});
