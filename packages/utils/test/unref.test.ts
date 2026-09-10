import { unref } from "../src/unref";

describe("unref", () => {
    it("calls unref on a Node-style handle", () => {
        const spy = jest.fn();
        unref({ unref: spy });
        expect(spy).toHaveBeenCalledTimes(1);
    });

    it("calls it with the handle as `this`", () => {
        // Node's timers implement `unref` on the prototype and read state off
        // `this`; calling it detached would throw. The old inline spelling —
        // `handle.unref?.()` — got this for free, so a helper that pulls the
        // function out has to put the receiver back.
        const handle = {
            refd: true,
            unref(this: { refd: boolean }) { this.refd = false; }
        };
        unref(handle);
        expect(handle.refd).toBe(false);
    });

    it("is a no-op on the browser's numeric timer handle", () => {
        // `setTimeout` returns a number in the browser and there is nothing to
        // unref. This is the case that made the inline version a *double* cast.
        expect(() => unref(7)).not.toThrow();
    });

    it("is a no-op on null, undefined and a handle without unref", () => {
        expect(() => unref(null)).not.toThrow();
        expect(() => unref(undefined)).not.toThrow();
        expect(() => unref({})).not.toThrow();
    });

    it("ignores a non-callable `unref` member", () => {
        expect(() => unref({ unref: "nope" })).not.toThrow();
    });
});
