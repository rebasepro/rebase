// Import a container field binding BEFORE field_configs on purpose. That is the
// dangerous entry into the field_configs <-> field bindings import cycle: it
// starts field_configs while this module is still initialising. See the comment
// on DEFAULT_FIELD_CONFIGS.
import { MapFieldBinding } from "../../src/form/field_bindings/MapFieldBinding";
import { RepeatFieldBinding } from "../../src/form/field_bindings/RepeatFieldBinding";
import { BlockFieldBinding } from "../../src/form/field_bindings/BlockFieldBinding";
import { TextFieldBinding } from "../../src/form/field_bindings/TextFieldBinding";

import { DEFAULT_FIELD_CONFIGS, getFieldConfig } from "../../src/components/field_configs";

describe("DEFAULT_FIELD_CONFIGS", () => {

    it("resolves every Field to a component, even entering the cycle from a binding", () => {
        const entries = Object.entries(DEFAULT_FIELD_CONFIGS);
        expect(entries.length).toBeGreaterThan(0);
        for (const [id, config] of entries) {
            const Field = (config.property as { ui?: { Field?: unknown } })?.admin?.Field;
            expect([id, typeof Field]).toEqual([id, "function"]);
        }
    });

    it("resolves the container fields to their own bindings", () => {
        const fieldOf = (id: keyof typeof DEFAULT_FIELD_CONFIGS) =>
            (DEFAULT_FIELD_CONFIGS[id].property as { admin: { Field: unknown } }).admin.Field;

        expect(fieldOf("group")).toBe(MapFieldBinding);
        expect(fieldOf("repeat")).toBe(RepeatFieldBinding);
        expect(fieldOf("block")).toBe(BlockFieldBinding);
        expect(fieldOf("text_field")).toBe(TextFieldBinding);
    });

    // This is the point of the exercise. The bindings are reachable from this
    // module only because `Field` is read lazily; inlining the getters back to
    // plain values reintroduces a load-order dependent TDZ crash that nothing
    // else would catch. Guard the mechanism, not just the result.
    it("declares Field lazily so it is never read during module init", () => {
        for (const [id, config] of Object.entries(DEFAULT_FIELD_CONFIGS)) {
            const admin = (config.property as { admin?: object }).admin;
            const descriptor = Object.getOwnPropertyDescriptor(admin, "Field");
            expect([id, typeof descriptor?.get]).toEqual([id, "function"]);
            expect([id, descriptor?.value]).toEqual([id, undefined]);
        }
    });

    it("still hands a working Field through getFieldConfig's merge", () => {
        const config = getFieldConfig({ type: "map" } as never, {});
        expect(typeof (config?.property as { ui?: { Field?: unknown } })?.admin?.Field).toBe("function");
    });
});
