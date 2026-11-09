import { serializeRegExp, hydrateRegExp, isValidRegExp } from "../src/regexp";

describe("regexp utils", () => {
    describe("serializeRegExp", () => {
        it("should serialize a regular expression into string", () => {
            expect(serializeRegExp(/^[a-z]+$/)).toBe("/^[a-z]+$/");
            expect(serializeRegExp(/foo/gi)).toBe("/foo/gi");
            expect(serializeRegExp(new RegExp("abc", "ig"))).toBe("/abc/gi");
        });

        it("should handle null or undefined input gracefully", () => {
            // Deliberately invalid: the guard under test must accept a missing RegExp, which the signature excludes.
            expect(serializeRegExp(undefined as never)).toBe("");
            // Deliberately invalid: as above, with null.
            expect(serializeRegExp(null as never)).toBe("");
        });
    });

    describe("hydrateRegExp", () => {
        it("should parse a serialized regular expression", () => {
            const regex = hydrateRegExp("/^[a-z]+$/g");
            expect(regex).toBeInstanceOf(RegExp);
            expect(regex?.source).toBe("^[a-z]+$");
            expect(regex?.flags).toBe("g");
        });

        it("should handle regex patterns without slashes", () => {
            const regex = hydrateRegExp("^[a-z]+$");
            expect(regex).toBeInstanceOf(RegExp);
            expect(regex?.source).toBe("^[a-z]+$");
            expect(regex?.flags).toBe("");
        });

        it("reads a plain pattern containing slashes as the whole pattern", () => {
            // Only a string that starts with `/` is a serialized literal.
            const sliced = hydrateRegExp("abc/def/g");
            expect(sliced?.source).toBe("abc\\/def\\/g");
            expect(sliced?.flags).toBe("");
            expect(sliced?.test("abc/def/g")).toBe(true);
            expect(sliced?.test("def")).toBe(false);

            const url = hydrateRegExp("https://example.com/users");
            expect(url?.test("https://example.com/users")).toBe(true);
            expect(isValidRegExp("https://example.com/users")).toBe(true);
        });

        it("keeps every slash inside a serialized literal's source", () => {
            const regex = hydrateRegExp("/a/b/i");
            expect(regex?.source).toBe("a\\/b");
            expect(regex?.flags).toBe("i");
        });

        it("should handle empty or undefined input gracefully", () => {
            expect(hydrateRegExp("")).toBeUndefined();
            expect(hydrateRegExp(undefined)).toBeUndefined();
        });
    });

    describe("isValidRegExp", () => {
        it("should accept stringified regex shapes", () => {
            expect(isValidRegExp("/^[a-z]+$/g")).toBe(true);
            expect(isValidRegExp("/foo/")).toBe(true);
            expect(isValidRegExp("foo")).toBe(true);
            expect(isValidRegExp("^\\d{4}-\\d{2}$")).toBe(true);
        });

        it("should reject patterns the RegExp engine cannot compile", () => {
            expect(isValidRegExp("/[a-z/g")).toBe(false); // unterminated character class
            expect(isValidRegExp("[a-z")).toBe(false);
            expect(isValidRegExp("(unclosed")).toBe(false);
            expect(isValidRegExp("a{3,1}")).toBe(false); // quantifier bounds out of order
            expect(isValidRegExp("*")).toBe(false); // nothing to repeat
            expect(isValidRegExp("\\")).toBe(false); // dangling escape
        });

        it("should reject empty input", () => {
            expect(isValidRegExp("")).toBe(false);
            // Deliberately invalid: the guard under test must refuse a missing string, which the signature excludes.
            expect(isValidRegExp(undefined as never)).toBe(false);
        });

        it("agrees with hydrateRegExp: anything it accepts, hydration compiles", () => {
            // The only meaningful definition of "valid" here is "hydrateRegExp
            // will not throw", since that is what the caller does next.
            for (const candidate of ["/^[a-z]+$/g", "/foo/", "foo", "^\\d{4}-\\d{2}$"]) {
                expect(isValidRegExp(candidate)).toBe(true);
                expect(hydrateRegExp(candidate)).toBeInstanceOf(RegExp);
            }
            for (const candidate of ["/[a-z/g", "[a-z", "(unclosed", "a{3,1}", "*", "\\"]) {
                expect(isValidRegExp(candidate)).toBe(false);
                expect(() => hydrateRegExp(candidate)).toThrow();
            }
        });
    });
});
