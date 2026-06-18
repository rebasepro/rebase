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

jest.mock("@rebasepro/admin", () => ({
    useUrlController: () => ({})
}));

describe("useDataEnhancementPlugin hook", () => {
    it("returns data enhancement plugin with correct metadata", () => {
        const { result } = renderHook(() => useDataEnhancementPlugin());
        const plugin = result.current;

        expect(plugin.key).toBe("data_enhancement");
        expect(plugin.slots).toBeDefined();
        expect(plugin.slots[0].slot).toBe("form.actions");
        expect(plugin.providers).toBeDefined();
        expect(plugin.providers[0].scope).toBe("form");
        expect(plugin.providers[0].props.apiKey).toBe("fcms-U9jdDii0xXWSDC34asfrf54lbkFJBfKfRWcEDEwdc4V5wDWEDF");
    });

    it("accepts and forwards custom apiKey and host props", () => {
        const customProps = {
            apiKey: "custom-key",
            host: "https://custom-host.com"
        };
        const { result } = renderHook(() => useDataEnhancementPlugin(customProps));
        const plugin = result.current;

        expect(plugin.providers[0].props.apiKey).toBe("custom-key");
        expect(plugin.providers[0].props.host).toBe("https://custom-host.com");
    });
});
