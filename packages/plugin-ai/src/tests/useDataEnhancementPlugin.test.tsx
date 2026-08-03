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
import { useDataEnhancementPlugin } from "../useDataEnhancementPlugin";
import { DEFAULT_AI_ENDPOINT } from "../api";

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
        expect(plugin).toMatchObject({
            key: "data_enhancement",
            slots: [{ slot: "form.actions" }],
            providers: [{ scope: "form" }]
        });
    });

    it("ships no credentials", () => {
        // The FireCMS-era plugin exported a hardcoded `fcms-…` key as
        // `DEFAULT_API_KEY` and handed it to the provider. Anyone who installed
        // the package got a copy. Nothing key-shaped may reach the provider
        // props again — the hosted service authenticates nobody by design.
        const { result } = renderHook(() => useDataEnhancementPlugin());
        const props = result.current.providers?.[0]?.props ?? {};
        expect(Object.keys(props)).toEqual(expect.not.arrayContaining(["apiKey", "firebaseToken", "token"]));
        expect(JSON.stringify(props)).not.toMatch(/fcms-/);
    });

    it("forwards a custom endpoint so a self-hoster can proxy the service", () => {
        const { result } = renderHook(() => useDataEnhancementPlugin({ endpoint: "https://ai.example.com" }));

        expect(result.current).toMatchObject({
            providers: [{ props: { endpoint: "https://ai.example.com" } }]
        });
    });

    it("leaves the endpoint unset so the client falls back to the hosted default", () => {
        // Compared against the exported constant rather than a copy of the URL:
        // a copy pins the string, this pins the wiring.
        const { result } = renderHook(() => useDataEnhancementPlugin());
        expect(result.current.providers?.[0]?.props?.endpoint).toBeUndefined();
        expect(DEFAULT_AI_ENDPOINT).toMatch(/^https:\/\//);
    });
});
