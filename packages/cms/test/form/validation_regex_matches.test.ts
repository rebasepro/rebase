/**
 * @jest-environment jsdom
 */
import type { StringProperty } from "@rebasepro/types";
import { hydrateRegExp } from "@rebasepro/utils";
import { mapPropertyToZod } from "../../src/form/validation";
import { fromSerializableProperty, toSerializableProperty } from "../../src/collection_editor/serializable_utils";

/**
 * `validation.matches` is judged the same way every time it is asked, and it
 * means the same pattern after the collection editor has written it to JSON.
 */
describe("validation.matches", () => {
    it("accepts the same value on every validation, whatever flags the pattern carries", async () => {
        // A `g` or `y` regex keeps `lastIndex` between `test` calls: the second
        // save of an untouched field failed with "Invalid format".
        const property = {
            type: "string",
            name: "Code",
            validation: { matches: /^[A-Z]{3}$/g }
        } as StringProperty;
        const schema = mapPropertyToZod({ property });
        for (let i = 0; i < 3; i++) {
            expect((await schema.safeParseAsync("ABC")).success).toBe(true);
        }
        const rebuilt = mapPropertyToZod({ property });
        expect((await rebuilt.safeParseAsync("ABC")).success).toBe(true);
        expect((await rebuilt.safeParseAsync("abc")).success).toBe(false);
    });

    it("keeps a RegExp's flags through the serializable form", async () => {
        const property = {
            type: "string",
            name: "Country",
            validation: { matches: /^[a-z]{2}$/i }
        } as StringProperty;
        const restored = fromSerializableProperty(JSON.parse(JSON.stringify(toSerializableProperty(property)))) as StringProperty;
        const matches = restored.validation?.matches;
        const pattern = typeof matches === "string" ? hydrateRegExp(matches) : matches;
        expect(pattern?.flags).toBe("i");
        expect(pattern?.source).toBe("^[a-z]{2}$");

        const schema = mapPropertyToZod({ property: restored });
        expect((await schema.safeParseAsync("US")).success).toBe(true);
        expect((await schema.safeParseAsync("USA")).success).toBe(false);
    });

    it("keeps a slash inside a RegExp through the serializable form", async () => {
        const property = {
            type: "string",
            name: "Path",
            validation: { matches: /^a\/b\/c$/ }
        } as StringProperty;
        const restored = fromSerializableProperty(JSON.parse(JSON.stringify(toSerializableProperty(property)))) as StringProperty;
        const schema = mapPropertyToZod({ property: restored });
        expect((await schema.safeParseAsync("a/b/c")).success).toBe(true);
        expect((await schema.safeParseAsync("a/b/d")).success).toBe(false);
    });
});
