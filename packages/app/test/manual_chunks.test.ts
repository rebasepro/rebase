/**
 * `rebaseManualChunks`, and the copy of it every scaffold carries in its
 * `frontend/vite.config.ts`.
 *
 * A name in these rules takes the unassigned dependencies of its modules with
 * it. `prism-react-renderer` depends on `clsx`, which the kit imports
 * statically, so in every scaffolded project `clsx` landed in `vendor-prism`
 * and the entry imported 85 kB of syntax highlighter to get a 633-byte helper
 * (React core went the same way into `vendor-dnd`/`vendor-dropzone`). Naming
 * the small shared libraries first keeps them out of the heavy groups.
 *
 * The template cannot import the function (the `@rebasepro/app` version it
 * pins does not publish it), so the two copies are compared rule by rule:
 * a fix that lands in one only is the drift this has already had.
 */
import fs from "node:fs";
import path from "node:path";
import { rebaseManualChunks } from "../src/vitePlugin";

const TEMPLATE = path.resolve(__dirname, "../../cli/templates/template/frontend/vite.config.ts");

const nm = (pkg: string, file = "index.js") => `/project/node_modules/.pnpm/${pkg.replace("/", "+")}@1.0.0/node_modules/${pkg}/${file}`;

/** The template's `manualChunks(id) { … }` body, as a callable. */
function templateManualChunks(): (id: string) => string | undefined {
    const source = fs.readFileSync(TEMPLATE, "utf8");
    const start = source.indexOf("manualChunks(id) {");
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    let bodyStart = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === "{") {
            if (depth === 0) bodyStart = i + 1;
            depth++;
        } else if (source[i] === "}") {
            depth--;
            if (depth === 0) {
                // eslint-disable-next-line no-new-func
                return new Function("id", source.slice(bodyStart, i)) as (id: string) => string | undefined;
            }
        }
    }
    throw new Error("unterminated manualChunks in the template");
}

const SAMPLES = [
    nm("clsx", "dist/clsx.mjs"),
    nm("react", "index.js"),
    nm("react", "cjs/react-jsx-runtime.production.js"),
    nm("scheduler", "index.js"),
    nm("use-sync-external-store", "shim/index.js"),
    nm("react-dom", "client.js"),
    nm("react-router", "dist/index.mjs"),
    nm("prism-react-renderer", "dist/index.mjs"),
    nm("markdown-it", "index.mjs"),
    nm("@dnd-kit/core", "dist/core.esm.js"),
    nm("react-dropzone", "dist/es/index.js"),
    nm("date-fns", "format.js"),
    nm("date-fns", "locale/de.js"),
    nm("exceljs", "dist/exceljs.min.js"),
    nm("@radix-ui/react-dialog", "dist/index.mjs"),
    nm("lucide-react", "dist/esm/icons/x.js"),
    "\0commonjsHelpers.js",
    "/project/frontend/src/App.tsx"
];

describe("rebaseManualChunks", () => {
    it("names clsx and React core on their own, before any heavy group can absorb them", () => {
        expect(rebaseManualChunks(nm("clsx", "dist/clsx.mjs"))).toBe("vendor-clsx");
        expect(rebaseManualChunks(nm("react"))).toBe("vendor-react");
        expect(rebaseManualChunks(nm("scheduler"))).toBe("vendor-react");
        expect(rebaseManualChunks(nm("use-sync-external-store", "shim/index.js"))).toBe("vendor-react");
        // Not swallowed by the React rule.
        expect(rebaseManualChunks(nm("react-dom", "client.js"))).toBe("vendor-react-dom");
        expect(rebaseManualChunks(nm("react-router", "dist/index.mjs"))).toBe("vendor-react-router");
        expect(rebaseManualChunks(nm("react-dropzone", "dist/es/index.js"))).toBe("vendor-dropzone");
    });

    it("the scaffold's copy answers the same for every rule", () => {
        const template = templateManualChunks();
        for (const id of SAMPLES) {
            expect([id, template(id)]).toEqual([id, rebaseManualChunks(id)]);
        }
    });
});
