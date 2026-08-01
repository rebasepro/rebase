import { serializeRegExp, hydrateRegExp, isValidRegExp } from "../src/regexp";

describe("regexp utils", () => {
    describe("serializeRegExp", () => {
        it("should serialize a regular expression into string", () => {
            expect(serializeRegExp(/^[a-z]+$/)).toBe("/^[a-z]+$/");
            expect(serializeRegExp(/foo/gi)).toBe("/foo/gi");
            expect(serializeRegExp(new RegExp("abc", "ig"))).toBe("/abc/gi");
        });

        it("should handle null or undefined input gracefully", () => {
            expect(serializeRegExp(undefined as any)).toBe("");
            expect(serializeRegExp(null as any)).toBe("");
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
            expect(isValidRegExp(undefined as any)).toBe(false);
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
