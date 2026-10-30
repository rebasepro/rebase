/**
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook } from "@testing-library/react";
import { StudioBridgeProvider, useStudioSchemaEditing } from "../../src/hooks/useStudioBridge";
import type { StudioSchemaEditing } from "../../src/hooks/useStudioBridge";

/**
 * `StudioBridgeProvider` memoises its context on the slices it is given, so a
 * host writing `value={{ ... }}` inline does not re-render every consumer. A
 * slice missing from that list is frozen at its first value: the schema
 * editing slice was, so an RLS editor kept the no-op editing it saw on mount
 * after the collection editor had mounted its real one.
 */
describe("StudioBridgeProvider", () => {
    const editing = (available: boolean): StudioSchemaEditing => ({
        available,
        updateCollection: async () => undefined
    });

    it("passes a schema editing slice that arrives after the first render", () => {
        const first = editing(false);
        const second = editing(true);
        let current = first;
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <StudioBridgeProvider value={{ schemaEditing: current }}>{children}</StudioBridgeProvider>
        );
        const { result, rerender } = renderHook(() => useStudioSchemaEditing(), { wrapper });
        expect(result.current).toBe(first);

        current = second;
        rerender();
        expect(result.current).toBe(second);
    });
});
