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
 * The scaffold used to carry a copy of these rules, compared here rule by rule,
 * because the `@rebasepro/app` it pinned did not publish the function. It
 * imports it now (`check:templates` holds that the import resolves against the
 * version `rebase init` pins), so what is held here is that it still does:
 * a copy creeping back is the drift this file was written against.
 */
import fs from "node:fs";
import path from "node:path";
import { rebaseManualChunks } from "../src/vitePlugin";

const TEMPLATE = path.resolve(__dirname, "../../cli/templates/template/frontend/vite.config.ts");

const nm = (pkg: string, file = "index.js") => `/project/node_modules/.pnpm/${pkg.replace("/", "+")}@1.0.0/node_modules/${pkg}/${file}`;

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

    it("is what the scaffold's vite config uses, not a copy of it", () => {
        const source = fs.readFileSync(TEMPLATE, "utf8");
        expect(source).toMatch(/import\s*\{[^}]*\brebaseManualChunks\b[^}]*\}\s*from\s*"@rebasepro\/app\/vitePlugin"/);
        expect(source).toMatch(/manualChunks:\s*rebaseManualChunks\b/);
        expect(source).not.toMatch(/manualChunks\s*\(\s*id\s*\)\s*\{/);
    });
});
