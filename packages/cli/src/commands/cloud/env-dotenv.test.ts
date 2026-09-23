/**
 * What `rebase cloud env pull` writes, read back the way the project reads it.
 *
 * Values were quoted with `JSON.stringify`, but a double-quoted dotenv value
 * unescapes only `\n` and `\r`: every other backslash stays. So `{"apiKey":
 * "abc"}` came back as `{\"apiKey\":\"abc\"}`, `say "hi"` as `say \"hi\"`, and
 * a Windows path grew doubled backslashes — the local `.env` silently
 * disagreed with the platform, and a JSON config failed to parse at runtime.
 */
import dotenv from "dotenv";
import { describe, expect, it } from "vitest";

import { dotenvLine } from "./env";

/** Write one variable and parse it back with the reader `rebase dev` uses. */
function roundTrip(value: string): string | undefined {
    const line = dotenvLine("VALUE", value);
    if (line === null) throw new Error(`refused to write ${JSON.stringify(value)}`);
    return dotenv.parse(`BEFORE=1\n${line}\nAFTER=2\n`).VALUE;
}

describe("dotenvLine", () => {
    it.each([
        ["JSON", "{\"apiKey\":\"abc\",\"n\":1}"],
        ["double quotes", "say \"hi\" there"],
        ["a Windows path", "C:\\temp dir\\x"],
        ["a PEM block", "-----BEGIN KEY-----\nabc\n-----END KEY-----"],
        ["a hash", "abc#def"],
        ["a single quote", "it's"],
        ["single and double quotes", "it's \"here\""],
        ["a single quote and a backtick", "it's `ticked`"],
        ["a Windows line ending", "line one\r\nline two"],
        ["surrounding spaces", "  padded  "],
        ["a backslash-n that is not a newline", "C:\\new\\raw"],
        ["a plain value", "postgres://u:p@h/db"],
        ["nothing", ""]
    ])("keeps %s intact", (_what, value) => {
        expect(roundTrip(value)).toBe(value);
    });

    it("does not disturb the lines around it", () => {
        const parsed = dotenv.parse(`BEFORE=1\n${dotenvLine("VALUE", "a\nb\"c'd")}\nAFTER=2\n`);

        expect(parsed.BEFORE).toBe("1");
        expect(parsed.AFTER).toBe("2");
    });

    it("refuses a value no dotenv quoting can carry, rather than writing a different one", () => {
        // All three quote characters, and a literal `\n` that double quotes
        // would turn into a newline.
        expect(dotenvLine("VALUE", "'`\"\\n")).toBeNull();
    });
});
