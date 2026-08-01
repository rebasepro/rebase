import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

// Mock window.matchMedia
if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn()
        }))
    });
}

import { renderHook } from "@testing-library/react";
import { DEFAULT_API_KEY, useDataEnhancementPlugin } from "../useDataEnhancementPlugin";

jest.mock("@rebasepro/admin", () => ({
    useUrlController: () => ({})
}));

describe("useDataEnhancementPlugin hook", () => {
    it("returns data enhancement plugin with correct metadata", () => {
        const { result } = renderHook(() => useDataEnhancementPlugin());
        const plugin = result.current;

        // Matched as one shape rather than indexed field by field. `slots` and
        // `providers` are optional on `Plugin`, and a preceding
        // `expect(...).toBeDefined()` does not narrow them for TypeScript — so
        // the indexed form only compiled because nothing type-checked this file.
        // `toMatchObject` needs no narrowing and pins the fields together, which
        // is what "correct metadata" actually means.
        //
        // `apiKey` is compared against the exported constant, not a copy of it:
        // a copy pins the key rather than the wiring that hands it to the
        // provider.
        expect(plugin).toMatchObject({
            key: "data_enhancement",
            slots: [{ slot: "form.actions" }],
            providers: [{ scope: "form", props: { apiKey: DEFAULT_API_KEY } }]
        });
    });

    it("accepts and forwards custom apiKey and host props", () => {
        const customProps = {
            apiKey: "custom-key",
            host: "https://custom-host.com"
        };
        const { result } = renderHook(() => useDataEnhancementPlugin(customProps));
        const plugin = result.current;

        expect(plugin).toMatchObject({
            providers: [{ props: { apiKey: "custom-key", host: "https://custom-host.com" } }]
        });
    });
});
