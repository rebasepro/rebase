import { Properties } from "@rebasepro/types";
import { applyDefaultValuesOnCreate, updateUserAutoValues } from "../src/util/entities";

describe("applyDefaultValuesOnCreate", () => {
    const properties: Properties = {
        title: { type: "string" },
        active: { type: "boolean", defaultValue: true },
        currency: { type: "string", defaultValue: "EUR" },
        count: { type: "number", defaultValue: 0 },
        tags: { type: "array", of: { type: "string" }, defaultValue: [] },
        prefs: {
            type: "map",
            properties: {
                notify: { type: "boolean", defaultValue: true },
                theme: { type: "string", defaultValue: "dark" }
            }
        }
    };

    it("fills only the keys the caller left out", () => {
        expect(applyDefaultValuesOnCreate({ title: "Hi" }, properties)).toEqual({
            title: "Hi",
            active: true,
            currency: "EUR",
            count: 0,
            tags: [],
            prefs: { notify: true, theme: "dark" }
        });
    });

    it("keeps a falsy value the caller sent", () => {
        // `false` and `0` are values, and `defaultValue ?? sent` would have
        // eaten both.
        const result = applyDefaultValuesOnCreate({ active: false, count: 0 }, properties);
        expect(result.active).toBe(false);
        expect(result.count).toBe(0);
    });

    it("keeps an explicit null, which says 'no value'", () => {
        expect(applyDefaultValuesOnCreate({ currency: null }, properties).currency).toBeNull();
    });

    it("invents nothing for a property with no declared default", () => {
        // `getDefaultValuesFor` hands a *form* `null` for an unset string so it
        // has something to render. Writing that would override the column's own
        // DEFAULT.
        expect("title" in applyDefaultValuesOnCreate({}, properties)).toBe(false);
    });

    /**
     * The sibling of "the form leaves excluded columns out". A column the API
     * refuses is still the server's to write in process, so its declared
     * default has to survive here — this reads the property, not the form
     * baseline, which is what keeps the two answers from being one answer.
     */
    it("still defaults a column the API excludes", () => {
        const withExcluded: Properties = {
            tokenVersion: { type: "number", defaultValue: 0, excludeFromApi: true }
        };
        expect(applyDefaultValuesOnCreate({}, withExcluded).tokenVersion).toBe(0);
    });

    it("merges a map field by field, so a partial object gains its siblings", () => {
        expect(applyDefaultValuesOnCreate({ prefs: { notify: false } }, properties).prefs)
            .toEqual({ notify: false, theme: "dark" });
    });

    it("leaves a map alone when the map itself declares a defaultValue", () => {
        const withMapDefault: Properties = {
            prefs: { type: "map", defaultValue: { a: 1 }, properties: { a: { type: "number" } } }
        };
        expect(applyDefaultValuesOnCreate({ prefs: { b: 2 } as never }, withMapDefault).prefs).toEqual({ b: 2 });
    });

    it("returns the values untouched when there are no properties", () => {
        expect(applyDefaultValuesOnCreate({ a: 1 }, undefined as unknown as Properties)).toEqual({ a: 1 });
    });

    it("honours a falsy declared default", () => {
        // `getDefaultValueFor` used to test `defaultValue || defaultValue === null`,
        // so a declared `0` or `""` fell through to the per-type default and
        // came back as `null`. Zero is the most ordinary default a number
        // column has, and the form had the same bug.
        const falsy: Properties = {
            count: { type: "number", defaultValue: 0 },
            note: { type: "string", defaultValue: "" },
            flag: { type: "boolean", defaultValue: false }
        };
        expect(applyDefaultValuesOnCreate({}, falsy)).toEqual({ count: 0, note: "", flag: false });
    });
});

describe("updateUserAutoValues", () => {
    const properties: Properties = {
        title: { type: "string" },
        createdBy: { type: "string", autoValue: "user_on_create" },
        updatedBy: { type: "string", autoValue: "user_on_update" }
    };

    it("stamps both on a create", () => {
        expect(updateUserAutoValues({
            inputValues: { title: "Hi" }, properties, status: "new", uid: "u1"
        })).toEqual({ title: "Hi", createdBy: "u1", updatedBy: "u1" });
    });

    it("stamps both on a copy — a copy is a new row with a new author", () => {
        expect(updateUserAutoValues({
            inputValues: {}, properties, status: "copy", uid: "u1"
        })).toEqual({ createdBy: "u1", updatedBy: "u1" });
    });

    it("leaves user_on_create alone on an update", () => {
        expect(updateUserAutoValues({
            inputValues: { title: "Hi" }, properties, status: "existing", uid: "u2"
        })).toEqual({ title: "Hi", updatedBy: "u2" });
    });

    it("overwrites whatever the body claimed", () => {
        expect(updateUserAutoValues({
            inputValues: { createdBy: "somebody-else" }, properties, status: "new", uid: "u1"
        }).createdBy).toBe("u1");
    });

    it("writes an explicit null when nobody is acting", () => {
        // Explicit, not absent: on an update, an absent key would leave the
        // previous editor's uid in place and record an anonymous edit as theirs.
        const result = updateUserAutoValues({
            inputValues: { title: "Hi" }, properties, status: "existing", uid: undefined
        });
        expect(result).toHaveProperty("updatedBy", null);
    });

    it("ignores a date autoValue — that is updateDateAutoValues' job", () => {
        const dates: Properties = { createdAt: { type: "date", autoValue: "on_create" } };
        expect(updateUserAutoValues({ inputValues: {}, properties: dates, status: "new", uid: "u1" })).toEqual({});
    });
});
