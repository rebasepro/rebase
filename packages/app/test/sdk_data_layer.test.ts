import { describe, expect, it } from "@jest/globals";
import { renderHook } from "@testing-library/react";
import type { DataDriver, DataSourceDefinition } from "@rebasepro/types";
import { createDataChanges } from "../src/hooks/data/dataChanges";
import { useBuildSdkDataLayer } from "../src/hooks/data/sdkData";

/**
 * Which flat layer the row hooks read: the default source by the same rule
 * `<Rebase>` picks the admin's data by, a new layer when a source changes,
 * and a driver read where it stores each collection.
 */

function driver(key: string, reads: string[] = []): DataDriver {
    return {
        key,
        fetchCollection: async ({ path }) => {
            reads.push(path);
            return [];
        },
        fetchOne: async () => undefined,
        save: async ({ values }) => values,
        delete: async () => undefined,
        checkUniqueField: async () => true
    };
}

type Sources = (DataSourceDefinition & { driver?: DataDriver })[];

const changes = createDataChanges();
const inputs = (dataSources: Sources, resolveDataPath: (slug: string) => string | undefined = () => undefined) => ({
    dataSources,
    resolveDataPath,
    resolveCollection: () => undefined,
    changes
});

describe("useBuildSdkDataLayer", () => {
    it("has no default source among several data sources, none of them the default, without a client", () => {
        const { result } = renderHook(() => useBuildSdkDataLayer(inputs([
            { key: "archive", engine: "firestore", driver: driver("archive") },
            { key: "logs", engine: "postgres", driver: driver("logs") }
        ])));
        expect(result.current).toBeUndefined();
    });

    it("is a new layer when a source's driver is a new one, and the same while it is the same", () => {
        const first = driver("(default)");
        const { result, rerender } = renderHook(({ sources }: { sources: Sources }) => useBuildSdkDataLayer(inputs(sources)), {
            initialProps: { sources: [{ key: "(default)", engine: "postgres", driver: first }] }
        });
        const layer = result.current;
        rerender({ sources: [{ key: "(default)", engine: "postgres", driver: first }] });
        expect(result.current).toBe(layer);
        rerender({ sources: [{ key: "(default)", engine: "postgres", driver: driver("(default)") }] });
        expect(result.current).not.toBe(layer);
    });

    it("reads a collection from where its driver stores it", async () => {
        const reads: string[] = [];
        const { result } = renderHook(() => useBuildSdkDataLayer(inputs(
            [{ key: "(default)", engine: "postgres", driver: driver("(default)", reads) }],
            (slug) => slug === "diagnosis" ? "fs_diagnosis" : undefined
        )));
        await result.current!.data.collection("diagnosis").find();
        expect(reads).toEqual(["fs_diagnosis"]);
    });
});
