import React from "react";
import { render } from "@testing-library/react";
import { Rebase } from "../src/core/Rebase";
import { useDataSources } from "../src/contexts/DataSourcesContext";
import { useData } from "../src/hooks/data/useData";
import type { DataDriver, RebaseClient, RebaseData } from "@rebasepro/types";

// Minimal driver — only needs to be a valid object; methods aren't invoked here.
function mockDriver(key: string): DataDriver {
    return {
        key,
        fetchCollection: jest.fn().mockResolvedValue([]),
        fetchOne: jest.fn().mockResolvedValue(undefined),
        save: jest.fn(),
        delete: jest.fn(),
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

const clientData = { collection: () => ({}) } as unknown as RebaseData;
// Minimal client — auth is never subscribed because an authController is passed.
const mockClient = { data: clientData, auth: {} } as unknown as RebaseClient;

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
                client={mockClient}
                storageSource={{} as any}
                {...props}>
                <Probe/>
            </Rebase>
        );
        return captured;
    }

    // `context.data`/`useData()` wraps the flat `client.data` at the CMS boundary
    // (Snapshot view-model). Assert it delegates to `clientData` rather than being
    // the same reference.
    function expectWrapsClientData(data?: RebaseData) {
        expect(data).toBeDefined();
        expect(data).not.toBe(clientData);
        const spy = jest.spyOn(clientData, "collection");
        data!.collection("widgets");
        expect(spy).toHaveBeenCalledWith("widgets");
        spy.mockRestore();
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

    it("infers transport when omitted: driver → direct, no driver → server", () => {
        const captured = renderWithProbe({
            dataSources: [
                { key: "analytics", engine: "firestore", driver: mockDriver("fs") },
                { key: "reporting", engine: "postgres" }
            ]
        });
        expect(captured.sources!.registry["analytics"].transport).toBe("direct");
        expect(captured.sources!.registry["reporting"].transport).toBe("server");
    });

    it("uses client.data as the default source when no '(default)' driver entry exists", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "analytics", engine: "firestore", driver: mockDriver("fs") }]
        });
        // At the core level (no navigation layer), useData() is the default source.
        // The flat SDK `client.data` is wrapped at the CMS boundary into the
        // Snapshot view-model, so it delegates to `clientData` rather than being it.
        expectWrapsClientData(captured.data);
    });

    it("lets a '(default)' entry with a driver override client.data", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "(default)", engine: "firestore", driver: mockDriver("fs") }]
        });
        expect(captured.data).toBe(captured.sources!.sources["(default)"]);
        expect(captured.data).not.toBe(clientData);
    });

    it("treats a '(default)' entry without a driver as definition-only (client.data stays default)", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "(default)", engine: "mongodb" }]
        });
        expect(captured.sources!.registry["(default)"]).toMatchObject({
            engine: "mongodb",
            transport: "server"
        });
        expect(captured.sources!.sources["(default)"]).toBeUndefined();
        expectWrapsClientData(captured.data);
    });

    it("does not build a RebaseData for server sources (no driver)", () => {
        const captured = renderWithProbe({
            dataSources: [{ key: "reporting", engine: "postgres", transport: "server" }]
        });
        expect(captured.sources!.registry["reporting"].transport).toBe("server");
        expect(captured.sources!.sources["reporting"]).toBeUndefined();
    });

    it("provides an empty data-source config when none is given", () => {
        const captured = renderWithProbe({});
        expect(captured.sources!.registry).toEqual({});
        expect(captured.sources!.sources).toEqual({});
    });

    it("uses the sole registered source as the default when there is no client", () => {
        const def = mockDriver("firestore");
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
                dataSources={[{ key: "main", engine: "firestore", driver: def }]}>
                <Probe/>
            </Rebase>
        );
        expect(captured.data).toBe(captured.sources!.sources["main"]);
    });

    it("throws when several sources are registered without a client or a '(default)' key", () => {
        const spy = jest.spyOn(console, "error").mockImplementation(() => {});
        function Probe() {
            useData();
            return null;
        }
        expect(() =>
            render(
                <Rebase
                    authController={mockAuthController}
                    storageSource={{} as any}
                    dataSources={[
                        { key: "a", engine: "firestore", driver: mockDriver("a") },
                        { key: "b", engine: "firestore", driver: mockDriver("b") }
                    ]}>
                    <Probe/>
                </Rebase>
            )
        ).toThrow(/none is the default/i);
        spy.mockRestore();
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
                    client={mockClient}
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
