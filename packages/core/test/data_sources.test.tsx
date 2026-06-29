import React from "react";
import { render } from "@testing-library/react";
import { Rebase } from "../src/core/Rebase";
import { useDataSources } from "../src/contexts/DataSourcesContext";
import { useData } from "../src/hooks/data/useData";
import type { DataDriver, RebaseData } from "@rebasepro/types";

// Minimal driver — only needs to be a valid object; methods aren't invoked here.
function mockDriver(key: string): DataDriver {
    return {
        key,
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchEntity: jest.fn().mockResolvedValue(undefined),
        saveEntity: jest.fn(),
        deleteEntity: jest.fn(),
        checkUniqueField: jest.fn().mockResolvedValue(true)
    } as unknown as DataDriver;
}

const mockAuthController: any = {
    user: { uid: "u1" },
    initialLoading: false,
    authLoading: false,
    loginSkipped: true,
    getAuthToken: jest.fn().mockResolvedValue("t")
};

const defaultData = { collection: () => ({}) } as unknown as RebaseData;

describe("<Rebase> data source wiring", () => {

    function renderWithProbe(props: Record<string, unknown>) {
        const captured: { sources?: ReturnType<typeof useDataSources>; data?: RebaseData } = {};
        function Probe() {
            captured.sources = useDataSources();
            captured.data = useData();
            return null;
        }
        render(
            <Rebase
                authController={mockAuthController}
                data={defaultData}
                storageSource={{} as any}
                {...props}>
                <Probe/>
            </Rebase>
        );
        return captured;
    }

    it("builds the data-source registry and a RebaseData for direct sources", () => {
        const fs = mockDriver("firestore");
        const captured = renderWithProbe({
            dataSources: [
                { key: "analytics", engine: "firestore", transport: "direct", driver: fs }
            ]
        });

        // Registry exposes the declaration (without leaking the driver instance).
        expect(captured.sources!.registry["analytics"]).toMatchObject({
            key: "analytics",
            engine: "firestore",
            transport: "direct"
        });
        // A built RebaseData is present for the direct source.
        expect(captured.sources!.sources["analytics"]).toBeDefined();
        expect(typeof captured.sources!.sources["analytics"].collection).toBe("function");
    });

    it("uses the explicit default (data prop) for the default RebaseData context", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "analytics", engine: "firestore", transport: "direct", driver: mockDriver("fs") }]
        });
        // At the core level (no navigation layer), useData() is the default source.
        expect(captured.data).toBe(defaultData);
    });

    it("does not build a RebaseData for server sources (no driver)", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "reporting", engine: "postgres", transport: "server" }]
        });
        expect(captured.sources!.registry["reporting"].transport).toBe("server");
        expect(captured.sources!.sources["reporting"]).toBeUndefined();
    });

    it("treats the deprecated `drivers` map as a direct source shorthand", () => {
        const captured = renderWithProbe({
            drivers: { firestore: mockDriver("firestore") }
        });
        expect(captured.sources!.registry["firestore"]).toMatchObject({
            key: "firestore",
            transport: "direct"
        });
        expect(captured.sources!.sources["firestore"]).toBeDefined();
    });

    it("provides an empty data-source config when none is given", () => {
        const captured = renderWithProbe({});
        expect(captured.sources!.registry).toEqual({});
        expect(captured.sources!.sources).toEqual({});
    });

    it("merges `dataSources` and the deprecated `drivers` map", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "analytics", engine: "firestore", transport: "direct", driver: mockDriver("fs") }],
            drivers: { legacy: mockDriver("legacy") }
        });
        expect(captured.sources!.registry["analytics"]).toBeDefined();
        expect(captured.sources!.registry["legacy"]).toMatchObject({ transport: "direct" });
        expect(captured.sources!.sources["analytics"]).toBeDefined();
        expect(captured.sources!.sources["legacy"]).toBeDefined();
    });

    it("falls back to a registered '(default)' direct source when no client/data/driver", () => {
        const def = mockDriver("default-direct");
        const captured: { data?: RebaseData; sources?: ReturnType<typeof useDataSources> } = {};
        function Probe() {
            captured.data = useData();
            captured.sources = useDataSources();
            return null;
        }
        render(
            <Rebase
                authController={mockAuthController}
                storageSource={{} as any}
                dataSources={[{ key: "(default)", engine: "postgres", transport: "direct", driver: def }]}>
                <Probe/>
            </Rebase>
        );
        // useData() resolves to the built RebaseData for the "(default)" source.
        expect(captured.data).toBe(captured.sources!.sources["(default)"]);
    });

    it("keeps the data-source context referentially stable across re-renders", () => {
        // Same driver instances, but a NEW array literal on each render — the
        // shallow-stable memo must not rebuild the sources (avoids effect thrash).
        const fs = mockDriver("fs");
        let renderCount = 0;
        const seen: ReturnType<typeof useDataSources>[] = [];
        function Probe() {
            seen.push(useDataSources());
            return null;
        }
        function Wrapper() {
            renderCount++;
            return (
                <Rebase
                    authController={mockAuthController}
                    data={defaultData}
                    storageSource={{} as any}
                    dataSources={[{ key: "analytics", engine: "firestore", transport: "direct", driver: fs }]}>
                    <Probe/>
                </Rebase>
            );
        }
        const { rerender } = render(<Wrapper/>);
        rerender(<Wrapper/>);
        expect(renderCount).toBeGreaterThanOrEqual(2);
        expect(seen.length).toBeGreaterThanOrEqual(2);
        // The sources map object must be the same instance across renders.
        expect(seen[seen.length - 1].sources).toBe(seen[0].sources);
    });

    it("throws when no data source of any kind is provided", () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        function Probe() {
            useData();
            return null;
        }
        expect(() =>
            render(
                <Rebase authController={mockAuthController} storageSource={{} as any}>
                    <Probe/>
                </Rebase>
            )
        ).toThrow(/requires either/i);
        spy.mockRestore();
    });
});
