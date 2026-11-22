import { describe, expect, it, jest } from "@jest/globals";
import { createAuth } from "../src/auth";
import { createMockTransport } from "./support/fake-transport";

/**
 * Node 22.23+ defines a `localStorage` of its own that prints "`--localstorage-file`
 * was provided without a valid path" the moment it is touched, so every script
 * using the SDK (a scaffold's `scripts/example.ts`, its seed) printed the warning.
 * Outside a browser the session lives in memory and that storage is never read.
 */
describe("auth storage outside a browser", () => {
    it("never touches a localStorage when there is no window", () => {
        if ("window" in globalThis) return; // a browser-like environment: nothing to prove here
        let touched = 0;
        const trap = {
            getItem: () => { touched++; return null; },
            setItem: () => { touched++; },
            removeItem: () => { touched++; }
        };
        Object.defineProperty(globalThis, "localStorage", { value: trap, configurable: true });
        try {
            const { transport } = createMockTransport({ apiPath: "/api", fetchFn: jest.fn<typeof fetch>() });
            const auth = createAuth(transport, {});
            expect(auth.getSession()).toBeNull();
            expect(touched).toBe(0);
        } finally {
            Reflect.deleteProperty(globalThis, "localStorage");
        }
    });
});
