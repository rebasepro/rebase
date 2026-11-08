/**
 * Compiling an app the model wrote: what it is told when the code cannot
 * open, in words it can act on in the same turn.
 *
 * - A syntax error names the line and shows it.
 * - An import the view does not provide is named, with the ones it does —
 *   a module, or a name from a module the view serves part of.
 * - An app needs a default export, and imports at the top only.
 * - What compiles keeps its line numbers, so a runtime error's line is the
 *   one the model wrote.
 */
import { describe, expect, it } from "vitest";
import { MCP_APP_MODULES } from "@rebasepro/types";
import { MAX_APP_SOURCE, compileApp } from "../src/compile";

function failure(source: string): string {
    const result = compileApp(source, MCP_APP_MODULES);
    if (result.ok) throw new Error("expected a refusal");
    return result.error;
}

describe("compiling an app", () => {
    it("names the line of a syntax error and shows it", () => {
        expect(failure("export default function App() {\n    return <div>;\n}"))
            .toMatch(/^The app does not compile: .*at line 2: return <div>;$/);
    });

    it("names an import the view does not provide, and the ones it does", () => {
        const error = failure("import { format } from \"date-fns\";\nexport default function App() { return format(new Date(), \"P\"); }");
        expect(error).toContain("\"date-fns\"");
        expect(error).toContain("\"@rebasepro/ui\"");
        expect(error).toContain("\"@rebasepro/cms\"");
        expect(error).not.toContain("react/jsx-runtime");
    });

    it("refuses the modules an app imported before the real package names", () => {
        expect(failure("import { useQuery } from \"@rebasepro/mcp-apps\";\nexport default function App() { useQuery(\"orders\"); return null; }"))
            .toContain("\"@rebasepro/mcp-apps\", which the view does not provide");
        expect(failure("import { KpiTile } from \"@rebasepro/plugin-insights\";\nexport default function App() { return <KpiTile/>; }"))
            .toContain("\"@rebasepro/plugin-insights\", which the view does not provide");
    });

    it("names an export the view does not serve from a module it serves part of, with its line and what it does serve", () => {
        const error = failure([
            "import { useState } from \"react\";",
            "import { useRows, useData } from \"@rebasepro/app\";",
            "export default function App() { return null; }"
        ].join("\n"));
        expect(error).toContain("\"useData\" from \"@rebasepro/app\" (line 2)");
        expect(error).toContain("useRows, useRow, useRowCount, useAggregate, useRowWrites");
        expect(failure("import CMS from \"@rebasepro/cms\";\nexport default function App() { return null; }"))
            .toContain("a default export from \"@rebasepro/cms\" (line 1)");
    });

    it("takes the names it serves, renamed or alongside a type, and a namespace", () => {
        const result = compileApp([
            "import { CollectionPanel as Panel, type CollectionPanelProps, FieldValue } from \"@rebasepro/cms\";",
            "import type { UseRowsResult } from \"@rebasepro/app\";",
            "import * as App from \"@rebasepro/app\";",
            "import { KpiTile, SplitView } from \"@rebasepro/ui\";",
            "export default function Desk() { return <Panel path=\"orders\"/>; }"
        ].join("\n"), MCP_APP_MODULES);
        if (!result.ok) throw new Error(result.error);
    });

    it("refuses an app with no default export, or one importing at runtime", () => {
        expect(failure("export function App() { return null; }")).toContain("no default export");
        expect(failure("export default function App() { void import(\"react\"); return null; }")).toContain("import(…)");
    });

    it("refuses an app longer than the view takes", () => {
        expect(failure(`export default function App() { return null; }\n//${"x".repeat(MAX_APP_SOURCE)}`))
            .toContain(`at most ${MAX_APP_SOURCE}`);
    });

    it("compiles TSX to modules the view's require serves, keeping the lines", () => {
        const result = compileApp([
            "import { useState } from \"react\";",
            "import { Card } from \"@rebasepro/ui\";",
            "type Props = { n: number };",
            "export default function App() {",
            "    const [n] = useState<number>(1);",
            "    return <Card>{n}</Card>;",
            "}"
        ].join("\n"), MCP_APP_MODULES);
        if (!result.ok) throw new Error(result.error);
        expect(result.code).toContain("require('@rebasepro/ui')");
        expect(result.code).toContain("require(\"react/jsx-runtime\")");
        expect(result.code.split("\n")[5]).toContain("_ui.Card");
    });
});
