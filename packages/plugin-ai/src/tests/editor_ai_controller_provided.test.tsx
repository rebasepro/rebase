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
import { render, waitFor } from "@testing-library/react";
import { AuthControllerContext } from "@rebasepro/app";
import { DataEnhancementControllerProvider } from "../components/DataEnhancementControllerProvider";
import { clearAiStatusCache } from "../api";

/**
 * AIX-23: the plugin built an editor controller for every form and handed it
 * to nothing, so a markdown field's AI slash command never appeared. The
 * form-scoped provider now gives it to the form's markdown fields — and only
 * while the plugin is enabled there: the service says it is available and
 * `getConfigForPath` allows the collection, the same gate Autofill has.
 */

/** What the provider handed the CMS's markdown-field slot, render by render. */
const provided: unknown[] = [];

jest.mock("@rebasepro/cms", () => ({
    getFieldId: () => "text_field",
    EditorAIControllerProvider: ({ controller, children }: { controller: unknown, children: React.ReactNode }) => {
        provided.push(controller);
        return children;
    }
}));

function mockStatus(available: boolean) {
    (global as any).fetch = jest.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ available, model: "m" })
    }));
}

function mount(getConfigForPath?: () => boolean) {
    return render(
        <AuthControllerContext.Provider value={{ user: null } as any}>
            <DataEnhancementControllerProvider
                path={"posts"}
                collection={{ name: "Posts", properties: {} } as any}
                getConfigForPath={getConfigForPath}
                formContext={{ values: {}, setFieldValue: jest.fn() } as any}
                {...({} as any)}>
                <div/>
            </DataEnhancementControllerProvider>
        </AuthControllerContext.Provider>
    );
}

const last = () => provided[provided.length - 1] as { autocomplete?: unknown } | undefined;

describe("the markdown fields' AI controller", () => {
    beforeEach(() => {
        provided.length = 0;
        clearAiStatusCache();
    });

    it("is given once the service says it is available", async () => {
        mockStatus(true);
        mount();
        expect(provided[0]).toBeUndefined();
        await waitFor(() => expect(typeof last()?.autocomplete).toBe("function"));
    });

    it("is not given while the service is unavailable", async () => {
        mockStatus(false);
        mount();
        await waitFor(() => expect(global.fetch).toHaveBeenCalled());
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(provided.length).toBeGreaterThan(0);
        expect(last()).toBeUndefined();
    });

    it("is not given where getConfigForPath turns the plugin off", async () => {
        mockStatus(true);
        mount(() => false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(provided.length).toBeGreaterThan(0);
        expect(last()).toBeUndefined();
    });
});
