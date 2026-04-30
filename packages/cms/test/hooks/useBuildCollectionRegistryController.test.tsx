import React from "react";
import { renderHook, act } from "@testing-library/react";
import { useBuildCollectionRegistryController } from "../../src/hooks/navigation/useBuildCollectionRegistryController";

// Mock DB schema for testing type constraints
interface TestDatabase {
    jobs: {
        Row: { id: string; title: string };
        Insert: { title: string };
        Update: { title?: string };
    };
    companies: {
        Row: { id: string; name: string };
        Insert: { name: string };
        Update: { name?: string };
    };
}

describe("useBuildCollectionRegistryController", () => {
    it("should allow type-safe getCollection access without throwing", () => {
        const { result } = renderHook(() => useBuildCollectionRegistryController<TestDatabase>({}));
        const controller = result.current;
        
        expect(controller).toBeDefined();
        expect(typeof controller.getCollection).toBe("function");

        // The generic will ensure IDE autocomplete allows "jobs" | "companies"
        // This is primarily testing the runtime interface matches expectations
        act(() => {
            const jobsCollection = controller.getCollection("jobs");
            expect(jobsCollection).toBeUndefined(); // It's undefined because we haven't mocked the internal registry context, but the call should succeed.
        });
    });
});
