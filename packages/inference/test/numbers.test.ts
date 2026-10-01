import { readNumberExactly } from "../src/numbers";

/**
 * One answer to "is this text a number", for the inference that picks a
 * column's type and the import that converts its cells: a text reads as a
 * number only when the number gives it back with nothing lost.
 */
describe("readNumberExactly", () => {
    it.each([
        ["12", 12],
        ["-5", -5],
        ["0", 0],
        ["10.00", 10],
        ["0.5", 0.5],
        ["1e3", 1000],
        ["2.5E-3", 0.0025],
        [" 42 ", 42],
        ["123456789012345", 123456789012345],
        ["0.000000000000000001", 1e-18]
    ])("%j → %p", (text, expected) => {
        expect(readNumberExactly(text)).toBe(expected);
    });

    it.each([
        ["02134", "a leading zero is an identifier"],
        ["-007", "a leading zero is an identifier"],
        ["12345678901234567890", "more digits than a double holds"],
        ["9007199254740993", "more digits than a double holds"],
        ["1,234", "a thousands separator"],
        ["$1.00", "a currency sign"],
        ["12%", "a percentage"],
        ["+15551234567", "a leading plus"],
        ["555-1234", "a phone number"],
        ["N/A", "not a number"],
        ["-", "not a number"],
        ["", "blank"],
        [".5", "no integer part"],
        ["1e400", "beyond a double"],
        ["Infinity", "not a number"],
        ["0x1F", "hexadecimal"]
    ])("%j is not (%s)", (text) => {
        expect(readNumberExactly(text)).toBeUndefined();
    });
});
