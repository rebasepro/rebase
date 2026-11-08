/**
 * show_app's guide teaches only what the view serves, and all of what it
 * serves from the packages it serves part of: `MCP_APP_MODULES`, the list the
 * view's module registry and the server's compiler both read.
 *
 * - Every module the example imports is served, and every name it imports
 *   from `@rebasepro/cms` or `@rebasepro/app` is one of theirs.
 * - Every hook the guide names is a served one.
 * - Every name served from `@rebasepro/cms` and `@rebasepro/app` is in the
 *   guide, so an export added to the view is taught too.
 *
 * The UI kit is served whole; that the guide's kit names exist is checked
 * against the kit itself, in `@rebasepro/mcp-apps`' suite.
 */
import { describe, expect, it } from "@jest/globals";
import { MCP_APP_MODULES, type McpAppModule } from "@rebasepro/types";
import { SHOW_APP_CODE_GUIDE } from "../src/mcp/mcp-tools";

const GUIDE = SHOW_APP_CODE_GUIDE;

function isServedModule(name: string): name is McpAppModule {
    return Object.hasOwn(MCP_APP_MODULES, name);
}

/** The example's imports: module → the runtime names taken from it. */
function exampleImports(): Map<string, string[]> {
    const imports = new Map<string, string[]>();
    for (const match of GUIDE.matchAll(/^import\s+(?!type\s)\{([^}]*)\}\s+from\s+"([^"]+)";$/gm)) {
        const names = match[1].split(",").map(part => part.trim()).filter(part => part !== "" && !part.startsWith("type "))
            .map(part => part.split(/\s+as\s+/)[0]);
        imports.set(match[2], [...(imports.get(match[2]) ?? []), ...names]);
    }
    return imports;
}

/** The names served from a module that serves part of itself. */
function servedNames(module: McpAppModule): readonly string[] {
    const served = MCP_APP_MODULES[module];
    return served === "*" ? [] : served;
}

describe("show_app's guide", () => {
    it("imports, in its example, only modules and names the view serves", () => {
        const imports = exampleImports();
        expect([...imports.keys()].sort()).toEqual(["@rebasepro/app", "@rebasepro/cms", "@rebasepro/ui", "react"]);
        for (const [module, names] of imports) {
            expect(isServedModule(module)).toBe(true);
            if (!isServedModule(module) || MCP_APP_MODULES[module] === "*") continue;
            expect(names.filter(name => !servedNames(module).includes(name))).toEqual([]);
        }
    });

    it("names only hooks the view serves", () => {
        const served = new Set([...servedNames("@rebasepro/app"), ...servedNames("@rebasepro/cms")]);
        // React's own hooks are React's.
        const hooks = [...new Set([...GUIDE.matchAll(/\b(use[A-Z]\w*)\(/g)].map(match => match[1]))]
            .filter(hook => !["useState", "useEffect", "useMemo", "useCallback", "useRef", "useReducer"].includes(hook));
        expect(hooks.filter(hook => !served.has(hook))).toEqual([]);
    });

    it("teaches every name the view serves from @rebasepro/cms and @rebasepro/app", () => {
        for (const module of ["@rebasepro/cms", "@rebasepro/app"] as const) {
            expect(servedNames(module).filter(name => !new RegExp(`\\b${name}\\b`).test(GUIDE))).toEqual([]);
        }
    });

    it("names the modules an app imports by their package names, and none it may not", () => {
        for (const module of Object.keys(MCP_APP_MODULES).filter(name => name !== "react/jsx-runtime")) {
            expect(GUIDE).toContain(`"${module}"`);
        }
        expect(GUIDE).not.toMatch(/@rebasepro\/(mcp-apps|plugin-insights)/);
    });
});
