/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import type { CollectionConfig } from "@rebasepro/types";
import { useBuildCollectionRegistryController } from "../../src/hooks/navigation/useBuildCollectionRegistryController";
import { CollectionRegistryContext } from "../../src/hooks/navigation/contexts/CollectionRegistryContext";
import { useChildViewSource } from "../../src/hooks/useChildViewSource";

const movements = {
    name: "Movements",
    slug: "movements",
    engine: "firestore",
    properties: {}
} as unknown as CollectionConfig;

const joints = {
    name: "Joints",
    slug: "medico/v2.0.0/joints",
    engine: "firestore",
    subcollections: () => [movements],
    properties: {}
} as unknown as CollectionConfig;

function renderChildViewSource(path: string) {
    const registry = renderHook(() => useBuildCollectionRegistryController({}));
    act(() => {
        registry.result.current.collectionRegistryRef.current.registerMultiple([joints]);
    });
    registry.rerender();

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <CollectionRegistryContext.Provider value={registry.result.current}>{children}</CollectionRegistryContext.Provider>
    );
    return renderHook(() => useChildViewSource(path), { wrapper }).result.current;
}

describe("useChildViewSource", () => {

    it("reads a slug with slashes as the root collection it is", () => {
        // Three segments, but one collection: taken as `parent/id/child`, this
        // looked up a parent called `medico` and warned about it on every render.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

        expect(renderChildViewSource("medico/v2.0.0/joints")).toBeUndefined();
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("finds a subcollection under a slug with slashes", () => {
        expect(renderChildViewSource("medico/v2.0.0/joints/j1/movements")).toEqual({ kind: "subcollection" });
    });
});
