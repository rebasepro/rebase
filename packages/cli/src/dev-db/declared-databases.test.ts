/**
 * The one reader of which databases a project declares beyond the default —
 * shared by `rebase dev` and every command that starts the managed database,
 * so the two can never disagree about which `DATABASE_URL__<KEY>` exist.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { deriveResourceGraph } = vi.hoisted(() => ({ deriveResourceGraph: vi.fn() }));

vi.mock("../manifest", async importOriginal => ({
    ...(await importOriginal<typeof import("../manifest")>()),
    loadManifest: () => ({ manifest: {} }),
    findBackendApp: () => ({ app: { name: "backend" } })
}));

vi.mock("../resources/derive", () => ({
    deriveOptionsFor: () => ({ projectRoot: "/p" }),
    deriveResourceGraph
}));

import { declaredAdditionalDatabases, declaredAdditionalKeys } from "./declared-databases";

afterEach(() => deriveResourceGraph.mockReset());

describe("declaredAdditionalDatabases", () => {
    it("is every server database but the default, in declaration order", async () => {
        deriveResourceGraph.mockResolvedValue({
            graph: {
                resources: [
                    { kind: "database", key: "(default)", transport: "server" },
                    { kind: "database", key: "analytics", transport: "server" },
                    { kind: "bucket", key: "media", transport: "server" },
                    { kind: "database", key: "browser", transport: "client" },
                    { kind: "database", key: "warehouse", transport: "server" }
                ]
            }
        });

        expect(await declaredAdditionalDatabases("/p")).toEqual(["analytics", "warehouse"]);
        expect(await declaredAdditionalKeys("/p")()).toEqual(["analytics", "warehouse"]);
    });

    it("declares nothing when the resources do not evaluate — the backend reports that itself", async () => {
        deriveResourceGraph.mockRejectedValue(new Error("resources.ts did not evaluate"));

        expect(await declaredAdditionalDatabases("/p")).toEqual([]);
    });

    it("reads nothing until the function is called", () => {
        declaredAdditionalKeys("/p");

        expect(deriveResourceGraph).not.toHaveBeenCalled();
    });
});
