import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

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

import React from "react";
import { act, render } from "@testing-library/react";
import { AuthControllerContext } from "@rebasepro/app";
import type { Properties } from "@rebasepro/types";

/**
 * The property map the autofill request carries is built from the form's
 * values (a block list contributes one entry per block). It was rebuilt on
 * every render of every form — every keystroke, whether or not anybody ever
 * pressed Autofill — and the build was quadratic in the number of blocks:
 * 22 ms per keystroke at 300 blocks, 371 ms at 1,000.
 */

jest.mock("@rebasepro/cms", () => ({
    getFieldId: (property: { type?: string }) => (property?.type === "string" ? "text_field" : "number_field")
}));

jest.mock("../utils/properties", () => {
    const actual = jest.requireActual("../utils/properties");
    return { ...actual, getSimplifiedProperties: jest.fn(actual.getSimplifiedProperties) };
});

import { getSimplifiedProperties } from "../utils/properties";
import { DataEnhancementControllerProvider, useDataEnhancementController } from "../components/DataEnhancementControllerProvider";
import { clearAiStatusCache } from "../api";

const BLOCKS = {
    content: {
        type: "array",
        name: "Content",
        oneOf: {
            properties: {
                text: { type: "string", name: "Text" },
                quote: { type: "map", name: "Quote", properties: { body: { type: "string", name: "Body" }, author: { type: "string", name: "Author" } } }
            }
        }
    }
} as unknown as Properties;

function blocks(n: number) {
    return {
        content: Array.from({ length: n }, (_, i) => i % 2
            ? { type: "text", value: `paragraph ${i}` }
            : { type: "quote", value: { body: `quote ${i}`, author: "A" } })
    };
}

/** The fastest of a few runs, after a warm-up: what the code costs, not what the machine was doing. */
function fastest(run: () => void): number {
    run();
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
        const start = performance.now();
        run();
        best = Math.min(best, performance.now() - start);
    }
    return best;
}

describe("the autofill property map", () => {
    beforeEach(() => {
        jest.mocked(getSimplifiedProperties).mockClear();
        clearAiStatusCache();
    });

    it("scales linearly with the number of blocks", () => {
        const small = blocks(1_000);
        const large = blocks(4_000);
        const tSmall = fastest(() => getSimplifiedProperties(BLOCKS, small));
        const tLarge = fastest(() => getSimplifiedProperties(BLOCKS, large));

        expect(Object.keys(getSimplifiedProperties(BLOCKS, large)).length).toBeGreaterThan(8_000);
        // 4x the blocks: ~4x the time when linear, ~16x when quadratic.
        expect(tLarge / Math.max(tSmall, 0.05)).toBeLessThan(8);
    });

    it("is not built while the operator types, only when a run starts", async () => {
        (global as unknown as { fetch: unknown }).fetch = jest.fn((url: string) => Promise.resolve(
            String(url).endsWith("/status")
                ? { ok: true, status: 200, json: async () => ({ available: true }) }
                : { ok: false, status: 500, json: async () => ({}) }
        ));
        const collection = { name: "Pages", properties: BLOCKS };
        let controller: ReturnType<typeof useDataEnhancementController> | undefined;
        function Probe() {
            controller = useDataEnhancementController();
            return null;
        }
        const ui = (values: Record<string, unknown>) => (
            <AuthControllerContext.Provider value={{ user: null } as never}>
                <DataEnhancementControllerProvider
                    {...({} as React.ComponentProps<typeof DataEnhancementControllerProvider>)}
                    path={"pages"}
                    collection={collection as never}
                    formContext={{ values, setFieldValue: jest.fn() } as never}>
                    <Probe/>
                </DataEnhancementControllerProvider>
            </AuthControllerContext.Provider>
        );

        const { rerender } = render(ui(blocks(10)));
        // Typing: a new values object on every keystroke.
        for (let i = 0; i < 20; i++) rerender(ui(blocks(10 + i)));
        await act(async () => {
            await Promise.resolve();
        });
        expect(getSimplifiedProperties).not.toHaveBeenCalled();

        await act(async () => {
            await controller!.generate({ values: blocks(30) });
        });
        expect(getSimplifiedProperties).toHaveBeenCalledTimes(1);
    });
});
