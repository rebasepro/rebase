import { describe, expect, it } from "@jest/globals";
import { resolveSurfaces } from "./surfaces";

/**
 * `REBASE_MCP_ENABLED` for a backend built in code. The containerized boot
 * path reads it through `resolveRole` (`boot/role.test.ts`); these cover
 * `createRebaseBackend`, which passes the process environment here.
 */
describe("resolveSurfaces with the environment", () => {
    it("keeps MCP off when nothing decides", () => {
        expect(resolveSurfaces(undefined, {}).mcp).toBe(false);
        expect(resolveSurfaces({}, { REBASE_MCP_ENABLED: "" }).mcp).toBe(false);
    });

    it("turns MCP on from REBASE_MCP_ENABLED when the options say nothing", () => {
        expect(resolveSurfaces(undefined, { REBASE_MCP_ENABLED: "true" }).mcp).toBe(true);
        expect(resolveSurfaces({ admin: true }, { REBASE_MCP_ENABLED: "true" }).mcp).toBe(true);
    });

    it("lets surfaces.mcp in code win over the variable", () => {
        expect(resolveSurfaces({ mcp: false }, { REBASE_MCP_ENABLED: "true" }).mcp).toBe(false);
        expect(resolveSurfaces({ mcp: true }, { REBASE_MCP_ENABLED: "false" }).mcp).toBe(true);
    });

    it("reads no environment unless it is given one", () => {
        const previous = process.env.REBASE_MCP_ENABLED;
        process.env.REBASE_MCP_ENABLED = "true";
        try {
            expect(resolveSurfaces().mcp).toBe(false);
        } finally {
            if (previous === undefined) delete process.env.REBASE_MCP_ENABLED;
            else process.env.REBASE_MCP_ENABLED = previous;
        }
    });

    it("touches no other surface", () => {
        const withEnv = resolveSurfaces({ data: false }, { REBASE_MCP_ENABLED: "true" });
        expect({ ...withEnv, mcp: false }).toEqual(resolveSurfaces({ data: false }));
    });
});
