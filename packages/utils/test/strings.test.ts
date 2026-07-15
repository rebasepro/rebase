import { toKebabCase, toSnakeCase, randomString, randomColor, slugify, unslugify, prettifyIdentifier } from "../src/strings";

describe("strings utils", () => {
    describe("toKebabCase", () => {
        it("should convert to kebab case", () => {
            expect(toKebabCase("helloWorld")).toBe("hello-world");
            expect(toKebabCase("Hello_World")).toBe("hello-world");
            expect(toKebabCase("fooBarBaz")).toBe("foo-bar-baz");
            expect(toKebabCase("XMLParser")).toBe("xml-parser");
            expect(toKebabCase("")).toBe("");
        });

        it("should preserve digit+letter sequences without splitting", () => {
            expect(toKebabCase("employee_number_140a")).toBe("employee-number-140a");
            expect(toKebabCase("insurance_id_140a")).toBe("insurance-id-140a");
            expect(toKebabCase("level2b")).toBe("level-2b");
            expect(toKebabCase("item3x")).toBe("item-3x");
        });

        it("should handle version-like strings", () => {
            expect(toKebabCase("version2")).toBe("version-2");
            expect(toKebabCase("v2release")).toBe("v-2-release");
        });
    });

    describe("toSnakeCase", () => {
        it("should convert to snake case", () => {
            expect(toSnakeCase("helloWorld")).toBe("hello_world");
            expect(toSnakeCase("Hello-World")).toBe("hello_world");
            expect(toSnakeCase("fooBarBaz")).toBe("foo_bar_baz");
            expect(toSnakeCase("XMLParser")).toBe("xml_parser");
            expect(toSnakeCase("")).toBe("");
        });

        it("should preserve digit+letter sequences (the medmot bug)", () => {
            // These are the exact column names that caused the medmot failure.
            // "140a" must NOT become "140_a".
            expect(toSnakeCase("employee_number_140a")).toBe("employee_number_140a");
            expect(toSnakeCase("contract_number_140a")).toBe("contract_number_140a");
            expect(toSnakeCase("service_provider_140a")).toBe("service_provider_140a");
            expect(toSnakeCase("internal_area_code_140a")).toBe("internal_area_code_140a");
            expect(toSnakeCase("fee_number_140a")).toBe("fee_number_140a");
            expect(toSnakeCase("receiver_market_participant_140a")).toBe("receiver_market_participant_140a");
            expect(toSnakeCase("employee_value_number_140a")).toBe("employee_value_number_140a");
            expect(toSnakeCase("sender_market_participant_140a")).toBe("sender_market_participant_140a");
            expect(toSnakeCase("processing_indicator_140a")).toBe("processing_indicator_140a");
            expect(toSnakeCase("insurance_id_140a")).toBe("insurance_id_140a");
        });

        it("should handle camelCase with trailing digit+letter", () => {
            expect(toSnakeCase("employeeNumber140a")).toBe("employee_number_140a");
            expect(toSnakeCase("insuranceId140a")).toBe("insurance_id_140a");
        });

        it("should handle standalone numbers and digit+letter combos", () => {
            expect(toSnakeCase("level2b")).toBe("level_2b");
            expect(toSnakeCase("item3x")).toBe("item_3x");
            expect(toSnakeCase("field99z")).toBe("field_99z");
        });

        it("should not merge digits into preceding word when no letter follows", () => {
            expect(toSnakeCase("version2")).toBe("version_2");
            expect(toSnakeCase("column42")).toBe("column_42");
            expect(toSnakeCase("test123")).toBe("test_123");
        });

        it("should preserve already snake_case input", () => {
            expect(toSnakeCase("already_snake")).toBe("already_snake");
            expect(toSnakeCase("foo_bar_baz")).toBe("foo_bar_baz");
            expect(toSnakeCase("a_b_c")).toBe("a_b_c");
        });

        it("should handle consecutive digit groups", () => {
            expect(toSnakeCase("abc123def456")).toBe("abc_123_def_456");
            expect(toSnakeCase("abc123d")).toBe("abc_123d");
        });

        it("should handle single characters and edge cases", () => {
            expect(toSnakeCase("a")).toBe("a");
            expect(toSnakeCase("A")).toBe("a");
            expect(toSnakeCase("aB")).toBe("a_b");
            expect(toSnakeCase("AB")).toBe("ab");
            expect(toSnakeCase("123")).toBe("123");
            expect(toSnakeCase("123a")).toBe("123a");
        });
    });

    describe("randomString", () => {
        it("should generate random string of given length", () => {
            const str1 = randomString(5);
            expect(str1.length).toBe(5);

            const str2 = randomString(10);
            expect(str2.length).toBe(10);

            expect(str1).not.toBe(str2);
        });

        it("should return the requested length every time", () => {
            // Slicing a single Math.random().toString(36) came up short about
            // once in 36 calls, which reads as a flaky test rather than the bug
            // it is. Loop so a regression fails on every run.
            for (let i = 0; i < 500; i++) {
                expect(randomString(10)).toHaveLength(10);
            }
        });

        it("should return lengths beyond what one Math.random() can supply", () => {
            // A double gives ~11 base-36 digits, so anything longer cannot come
            // from slicing one of them — this fails deterministically if it does.
            for (const length of [1, 12, 24, 64]) {
                expect(randomString(length)).toHaveLength(length);
            }
        });

        it("should only use base-36 characters", () => {
            expect(randomString(200)).toMatch(/^[0-9a-z]+$/);
        });
    });

    describe("randomColor", () => {
        it("should generate random hex color", () => {
            const tempMathRandom = Math.random;
            Math.random = () => 0.5;

            const color = randomColor();
            expect(color).toBe("7fffff");

            Math.random = tempMathRandom;
        });
    });

    describe("slugify", () => {
        it("should convert text to slug", () => {
            expect(slugify("Hello World!")).toBe("hello_world");
            expect(slugify("Hello World!", "-")).toBe("hello-world");
            expect(slugify("Hello World!", "_", false)).toBe("Hello_World");
            expect(slugify("ãàáäâẽèéëê", "-")).toBe("aaaaaeeeee");
            expect(slugify("foo & bar")).toBe("foo_bar");
            expect(slugify("  whitespaces  ")).toBe("whitespaces");
            expect(slugify("")).toBe("");
            expect(slugify(undefined)).toBe("");
        });
    });

    describe("unslugify", () => {
        it("should convert slug to normal text", () => {
            expect(unslugify("hello-world")).toBe("Hello World");
            expect(unslugify("hello_world")).toBe("Hello World");
            expect(unslugify("hello_world_test")).toBe("Hello World Test");
            expect(unslugify("already normal")).toBe("already normal");
            expect(unslugify("")).toBe("");
            expect(unslugify(undefined)).toBe("");
        });
    });

    describe("prettifyIdentifier", () => {
        it("should format identifier nicely", () => {
            expect(prettifyIdentifier("imageURL")).toBe("Image URL");
            expect(prettifyIdentifier("XMLParser")).toBe("XML Parser");
            expect(prettifyIdentifier("hello_world")).toBe("Hello World");
            expect(prettifyIdentifier("hello-world")).toBe("Hello World");
            expect(prettifyIdentifier("CamelCaseTested")).toBe("Camel Case Tested");
            expect(prettifyIdentifier("")).toBe("");
        });
    });
});
