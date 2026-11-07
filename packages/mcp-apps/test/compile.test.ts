/**
 * Compiling an app the model wrote: what it is told when the code cannot
 * open, in words it can act on in the same turn.
 *
 * - A syntax error names the line and shows it.
 * - An import the view does not provide is named, with the ones it does.
 * - An app needs a default export, and imports at the top only.
 * - What compiles keeps its line numbers, so a runtime error's line is the
 *   one the model wrote.
 */
import { describe, expect, it } from "vitest";
import { MAX_APP_SOURCE, compileApp } from "../src/compile";

function failure(source: string): string {
    const result = compileApp(source);
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
        expect(error).not.toContain("react/jsx-runtime");
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
        ].join("\n"));
        if (!result.ok) throw new Error(result.error);
        expect(result.code).toContain("require('@rebasepro/ui')");
        expect(result.code).toContain("require(\"react/jsx-runtime\")");
        expect(result.code.split("\n")[5]).toContain("_ui.Card");
    });
});
