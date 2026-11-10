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
import { MCP_TOOLS, SHOW_APP_CODE_GUIDE, SHOW_APP_ESSENTIALS, showAppArtifactGuide } from "../src/mcp/mcp-tools";

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

    // The view's stylesheet is built before the app arrives, from a list of
    // standard utilities (`MCP_VIEW_UTILITIES`): an arbitrary value is not in
    // it, so a parent sized `h-[560px]` has no height and its SplitView none.
    it("uses no arbitrary-value class, which the view does not generate", () => {
        const classes = [...GUIDE.matchAll(/className="([^"]*)"/g)].flatMap(match => match[1].split(/\s+/));
        expect(classes.length).toBeGreaterThan(0);
        expect(classes.filter(name => name.includes("["))).toEqual([]);
    });

    it("names the modules an app imports by their package names, and none it may not", () => {
        for (const module of Object.keys(MCP_APP_MODULES).filter(name => name !== "react/jsx-runtime")) {
            expect(GUIDE).toContain(`"${module}"`);
        }
        expect(GUIDE).not.toMatch(/@rebasepro\/(mcp-apps|plugin-insights)/);
    });
});

describe("show_app's description", () => {
    // claude.ai cuts a tool's description at about 4,000 characters; the
    // guide in full is ~8,000, and what fell past the cut was the UI kit.
    it("is short enough for a host to show whole", () => {
        const showApp = MCP_TOOLS.find(tool => tool.name === "show_app");
        expect(showApp?.description).toContain(SHOW_APP_ESSENTIALS);
        expect(showApp?.description.length).toBeLessThan(3000);
    });

    it("names, from the packages served in part, only what they serve, and only what the guide teaches", () => {
        const served = new Set([...servedNames("@rebasepro/app"), ...servedNames("@rebasepro/cms")]);
        const taught = (name: string) => new RegExp(`\\b${name}\\b`).test(GUIDE);
        const named = [...new Set([...SHOW_APP_ESSENTIALS.matchAll(/\b([A-Z][A-Za-z]+|use[A-Z]\w*)\b/g)].map(match => match[1]))]
            .filter(name => /^use[A-Z]/.test(name) || /^(Collection|Record|Form|Field|Split|Kpi|Chart|Bar|TimeSeries|Card|Button|Tabs)/.test(name));
        expect(named.length).toBeGreaterThan(10);
        expect(named.filter(name => name.startsWith("use") && !served.has(name))).toEqual([]);
        expect(named.filter(name => !taught(name))).toEqual([]);
    });
});

describe("show_app's artifact guide", () => {
    const guide = showAppArtifactGuide("https://cdn.example/kit.js");

    it("loads the kit from where the server says it is, in the page the kit reads", () => {
        expect(guide).toContain('<script type="module" src="https://cdn.example/kit.js"></script>');
        // The ids `readPageApp` in @rebasepro/mcp-apps' artifact entry reads.
        for (const id of ['id="rebase-app"', 'id="rebase-app-code"', 'id="root"']) expect(guide).toContain(id);
    });

    it("names, for a project's own connector, only tools this server has", () => {
        const names = new Set(MCP_TOOLS.map(tool => tool.name));
        for (const tool of ["show_app", "query_collection", "get_document", "count_documents", "aggregate_documents", "create_document", "update_document", "delete_document"]) {
            expect(guide).toContain(`"${tool}"`);
            expect(names.has(tool)).toBe(true);
        }
    });

    it("tells the author a write goes plan, then confirm, through the kit and nothing else", () => {
        expect(guide).toContain("plan, then confirm");
        expect(guide).toContain("only once the viewer has said yes");
        expect(guide).toContain("a new row, a delete, and any write the app's code makes without a click");
        expect(guide).toContain("never send a confirm token yourself");
    });
});

describe("the read tools' output schemas", () => {
    it("describe a page, a count and a row, and only on tools that send a structured result", () => {
        const schemaOf = (name: string) => MCP_TOOLS.find(tool => tool.name === name)?.outputSchema;
        expect(schemaOf("query_collection")).toMatchObject({ required: ["data"] });
        expect(schemaOf("aggregate_documents")).toMatchObject({ required: ["data"] });
        expect(schemaOf("count_documents")).toMatchObject({ required: ["count"] });
        expect(schemaOf("get_document")).toMatchObject({ type: "object" });
        for (const tool of MCP_TOOLS) {
            if (tool.outputSchema) expect(tool.structuredContent).not.toBe(false);
        }
    });
});
