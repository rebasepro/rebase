import { describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

/**
 * Studio is the BaaS console: it renders every schema-aware view from the
 * tables the server serves (`useTableDescriptors` in `@rebasepro/app`), and
 * `@rebasepro/cms` is an optional peer it never imports. What only a CMS can
 * do — open a row in its record editor — reaches Studio over the Studio
 * bridge, which is a no-op without one.
 */

const SRC = path.resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(full);
        return /\.(ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [full] : [];
    });
}

/** Every module specifier a file names: static imports and re-exports, `import()`, `require()`. */
function specifiers(source: string): string[] {
    const found: string[] = [];
    const patterns = [
        /\b(?:import|export)\s[^'"]*?\bfrom\s*["']([^"']+)["']/g,
        /\bimport\s*["']([^"']+)["']/g,
        /\bimport\(\s*["']([^"']+)["']\s*\)/g,
        /\brequire\(\s*["']([^"']+)["']\s*\)/g
    ];
    for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) found.push(match[1]);
    }
    return found;
}

const isCms = (specifier: string) => specifier === "@rebasepro/cms" || specifier.startsWith("@rebasepro/cms/");

describe("Studio without the CMS", () => {
    it("imports nothing from @rebasepro/cms anywhere in its source", () => {
        const files = sourceFiles(SRC);
        expect(files.length).toBeGreaterThan(20);
        const offenders = files.flatMap(file =>
            specifiers(fs.readFileSync(file, "utf8")).filter(isCms).map(specifier => `${path.relative(SRC, file)}: ${specifier}`));
        expect(offenders).toEqual([]);
    });

    it("tells the cms-types package apart from the CMS", () => {
        expect(isCms("@rebasepro/cms-types")).toBe(false);
        expect(specifiers(`import { x } from "@rebasepro/cms";\nconst y = await import("@rebasepro/cms/editor");`).filter(isCms))
            .toEqual(["@rebasepro/cms", "@rebasepro/cms/editor"]);
    });

    it("declares the CMS as an optional peer and never as a dependency", () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
            dependencies?: Record<string, string>;
            peerDependencies?: Record<string, string>;
            peerDependenciesMeta?: Record<string, { optional?: boolean }>;
        };
        expect(manifest.dependencies?.["@rebasepro/cms"]).toBeUndefined();
        if (manifest.peerDependencies?.["@rebasepro/cms"] !== undefined) {
            expect(manifest.peerDependenciesMeta?.["@rebasepro/cms"]?.optional).toBe(true);
        }
    });

    it("reads its tables from @rebasepro/app, not from the bridge's collection registry", () => {
        const schemaViews = ["components/SchemaVisualizer/SchemaVisualizer.tsx", "components/RLSEditor/RLSEditor.tsx", "components/ApiKeys/CreateApiKeyDialog.tsx"];
        for (const view of schemaViews) {
            const source = fs.readFileSync(path.join(SRC, view), "utf8");
            expect(source).toContain("useTableDescriptors");
            expect(source).not.toContain("useStudioCollectionRegistry");
        }
    });
});
