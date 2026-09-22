/**
 * @jest-environment jsdom
 */
import { describe, expect, it } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { Property } from "@rebasepro/types";
import { useClearRestoreValue } from "../../src/form/useClearRestoreValue";

/**
 * `clearOnDisabled` empties a field while it is disabled and puts the value
 * back when it is enabled again. The value it held was also its "was anything
 * cleared" flag, so a falsy value — a 0, a `false` — was cleared and never came
 * back: the field returned from being disabled empty.
 */
describe("useClearRestoreValue", () => {

    const enabled = { type: "number", admin: { disabled: false } } as Property;
    const disabledAndCleared = { type: "number", admin: { disabled: { clearOnDisabled: true } } } as Property;

    function run<T>(value: T) {
        const writes: (T | null)[] = [];
        const hook = renderHook(({ property, current }: { property: Property, current: T | null }) =>
            useClearRestoreValue<T>({ property, value: current, setValue: (next) => { writes.push(next); } }), {
            initialProps: { property: enabled, current: value }
        });
        hook.rerender({ property: disabledAndCleared, current: value });
        hook.rerender({ property: enabled, current: null });
        return writes;
    }

    it("restores a truthy value", () => {
        expect(run(7)).toEqual([null, 7]);
    });

    it("restores a zero", () => {
        expect(run(0)).toEqual([null, 0]);
    });

    it("restores a false", () => {
        expect(run(false)).toEqual([null, false]);
    });

    it("restores an empty string", () => {
        expect(run("")).toEqual([null, ""]);
    });

    it("writes nothing for a field that held nothing", () => {
        expect(run(null)).toEqual([]);
    });

});
