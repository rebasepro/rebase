import { enumToObjectEntries } from "../src/util/enums";

describe("enums utils", () => {
    describe("enumToObjectEntries", () => {
        it("should output the same array if input is already an array of EnumValueConfig", () => {
            const arr = [{ id: "a",
label: "A" }];
            expect(enumToObjectEntries(arr)).toBe(arr);
        });

        it("should parse an object mapping strings to strings", () => {
            const obj = { start: "Start",
stop: "Stop" };
            const result = enumToObjectEntries(obj);
            expect(result).toEqual([
                { id: "start",
label: "Start" },
                { id: "stop",
label: "Stop" }
            ]);
        });

        it("should parse an object mapping strings to EnumValueConfig-like objects", () => {
            const obj = {
                start: { label: "Start",
color: "green" },
                stop: { label: "Stop",
color: "red" }
            };
            // The values lack `id` on purpose — supplying it is what this
            // function does — so the fixture cannot be a well-typed `EnumValues`.
            // @ts-expect-error entries without `id` are outside `EnumValues`
            const result = enumToObjectEntries(obj);
            expect(result).toEqual([
                { id: "start",
label: "Start",
color: "green" },
                { id: "stop",
label: "Stop",
color: "red" }
            ]);
        });
    });
});
