import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { resetDeprecationWarningsForTests, warnDeprecated } from "../src";

describe("warnDeprecated", () => {
    let warn: jest.SpiedFunction<typeof console.warn>;

    beforeEach(() => {
        resetDeprecationWarningsForTests();
        warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        warn.mockRestore();
        resetDeprecationWarningsForTests();
    });

    it("warns the first time a key is used, with the message", () => {
        warnDeprecated("oldName", "`oldName` is deprecated; use `newName` instead.");

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain("`oldName` is deprecated; use `newName` instead.");
    });

    it("says nothing the second time the same key is used", () => {
        warnDeprecated("oldName", "first");
        warnDeprecated("oldName", "second");
        warnDeprecated("oldName", "third");

        expect(warn).toHaveBeenCalledTimes(1);
    });

    it("warns once for each different key", () => {
        warnDeprecated("a", "a is deprecated");
        warnDeprecated("b", "b is deprecated");
        warnDeprecated("a", "a is deprecated");

        expect(warn.mock.calls.map(call => String(call[0]))).toEqual([
            expect.stringContaining("a is deprecated"),
            expect.stringContaining("b is deprecated")
        ]);
    });

    it("warns again after the test reset", () => {
        warnDeprecated("oldName", "deprecated");
        resetDeprecationWarningsForTests();
        warnDeprecated("oldName", "deprecated");

        expect(warn).toHaveBeenCalledTimes(2);
    });
});
