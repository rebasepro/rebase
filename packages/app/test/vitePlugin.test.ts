import { rebaseCollectionsPlugin, transformCollectionSource } from "../src/vitePlugin";

/**
 * Helper: create a fully initialised plugin instance and return its
 * `transform` method bound to a collections directory.
 */
function createTransform(collectionsDir = "/project/config/collections") {
    const plugin = rebaseCollectionsPlugin({ collectionsDir });

    // Simulate Vite calling configResolved with a root
    (plugin as { configResolved: (config: { root: string }) => void }).configResolved({ root: "/project" });

    return (code: string, filename = `${collectionsDir}/products.ts`) =>
        plugin.transform(code, filename);
}

describe("rebaseCollectionsPlugin — transform hook", () => {

    // ── Basic transformations ────────────────────────────────────────

    it("transforms a Field string into a LazyComponentRef", () => {
        const transform = createTransform();
        const input = 'const c = { Field: "../../components/MyField" };';
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain('import("../../components/MyField")');
    });

    it("transforms a Preview string", () => {
        const transform = createTransform();
        const input = 'const c = { Preview: "../frontend/SubscriptionBadge" };';
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain('import("../frontend/SubscriptionBadge")');
    });

    it("transforms a Builder string", () => {
        const transform = createTransform();
        const input = 'const c = { Builder: "./views/CustomBuilder" };';
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain('import("./views/CustomBuilder")');
    });

    it("handles single-quoted paths", () => {
        const transform = createTransform();
        const input = "const c = { Field: './components/MyField' };";
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain("import('./components/MyField')");
    });

    // ── Multiple matches ─────────────────────────────────────────────

    it("transforms multiple component refs in the same file", () => {
        const transform = createTransform();
        const input = `
            const config = {
                properties: {
                    name: {
                        type: "string",
                        ui: {
                            Field: "../../components/NameField",
                            Preview: "../../components/NamePreview"
                        }
                    }
                },
                views: [{
                    key: "custom",
                    Builder: "../views/CustomView"
                }]
            };
        `;
        const result = transform(input);
        expect(result).not.toBeNull();

        const output = result!.code;
        // All three should be transformed
        expect(output).toContain('import("../../components/NameField")');
        expect(output).toContain('import("../../components/NamePreview")');
        expect(output).toContain('import("../views/CustomView")');

        // Count __rebaseLazy occurrences
        const lazyCount = (output.match(/__rebaseLazy/g) || []).length;
        expect(lazyCount).toBe(3);
    });

    // ── Non-matching patterns (should NOT transform) ─────────────────

    it("does not transform non-relative strings (no ./ or ../ prefix)", () => {
        const transform = createTransform();
        const input = 'const c = { Field: "components/MyField" };';
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does not transform keys not in the LAZY_COMPONENT_KEYS list", () => {
        const transform = createTransform();
        const input = 'const c = { Icon: "../../components/MyIcon" };';
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does not transform numeric values", () => {
        const transform = createTransform();
        const input = "const c = { Field: 42 };";
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does not transform object/function values", () => {
        const transform = createTransform();
        const input = 'const c = { Field: () => import("../../components/MyField") };';
        const result = transform(input);
        expect(result).toBeNull();
    });

    // ── File filtering ───────────────────────────────────────────────

    it("ignores files outside the collections directory", () => {
        const transform = createTransform("/project/config/collections");
        const code = 'const c = { Field: "../../components/MyField" };';
        const result = transform(code, "/project/src/other/file.ts");
        expect(result).toBeNull();
    });

    it("ignores non-TS/TSX files inside the collections directory", () => {
        const transform = createTransform("/project/config/collections");
        const code = 'const c = { Field: "../../components/MyField" };';
        const result = transform(code, "/project/config/collections/readme.md");
        expect(result).toBeNull();
    });

    it("processes .tsx files inside the collections directory", () => {
        const transform = createTransform("/project/config/collections");
        const code = 'const c = { Field: "../../components/MyField" };';
        const result = transform(code, "/project/config/collections/products.tsx");
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
    });

    // ── Preserves non-component strings ──────────────────────────────

    it("preserves regular string properties", () => {
        const transform = createTransform();
        const input = `
            const config = {
                name: "Products",
                slug: "products",
                type: "../string",
                Field: "../../components/MyField"
            };
        `;
        const result = transform(input);
        expect(result).not.toBeNull();
        const output = result!.code;
        // Only Field should be transformed
        expect(output).toContain('"Products"');
        expect(output).toContain('"products"');
        expect(output).toContain('"../string"'); // `type` key is not in LAZY_COMPONENT_KEYS
        expect((output.match(/__rebaseLazy/g) || []).length).toBe(1);
    });

    // ── Output structure ─────────────────────────────────────────────

    it("produces valid JavaScript syntax in the output", () => {
        const transform = createTransform();
        const input = 'const c = { Field: "../../components/MyField" };';
        const result = transform(input);
        const output = result!.code;
        // Should be a valid object literal fragment
        expect(output).toBe(
            'const c = { Field: { __rebaseLazy: true, load: () => import("../../components/MyField") } };'
        );
    });

    // ── AST-specific: known regex failure cases ──────────────────────

    it("does NOT transform a commented-out line (single-line comment)", () => {
        const transform = createTransform();
        const input = `
            const config = {
                // Field: "./old"
                name: "Products"
            };
        `;
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does NOT transform inside a block comment", () => {
        const transform = createTransform();
        const input = `
            const config = {
                /* Field: "./old" */
                name: "Products"
            };
        `;
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does NOT transform inside a template literal", () => {
        const transform = createTransform();
        const input = "const s = `Field: \"./foo\"`;\n";
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does NOT transform a key with a matching suffix (e.g. xField)", () => {
        const transform = createTransform();
        const input = `
            const config = {
                xField: "./components/MyField"
            };
        `;
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does NOT transform a key with a matching prefix (e.g. myBuilder)", () => {
        const transform = createTransform();
        const input = `
            const config = {
                myBuilder: "./views/CustomBuilder"
            };
        `;
        const result = transform(input);
        expect(result).toBeNull();
    });

    it("does NOT transform a key with a matching prefix (e.g. FieldExtra)", () => {
        const transform = createTransform();
        const input = `
            const config = {
                FieldExtra: "./components/Extra"
            };
        `;
        const result = transform(input);
        expect(result).toBeNull();
    });

    // ── AST-specific: edge cases that SHOULD transform ───────────────

    it("transforms a multiline key-value (value on next line)", () => {
        const transform = createTransform();
        const input = `
            const config = {
                Field:
                    "../../components/MyField"
            };
        `;
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain('import("../../components/MyField")');
    });

    it("transforms with extra whitespace around colon", () => {
        const transform = createTransform();
        const input = `
            const config = {
                Field :  "../../components/MyField"
            };
        `;
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain('import("../../components/MyField")');
    });

    it("transforms a string-literal key form", () => {
        const transform = createTransform();
        const input = `
            const config = {
                "Field": "../../components/MyField"
            };
        `;
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain("__rebaseLazy: true");
        expect(result!.code).toContain('import("../../components/MyField")');
    });

    it("transforms a deeply nested object property", () => {
        const transform = createTransform();
        const input = `
            const config = {
                properties: {
                    name: {
                        ui: {
                            Field: "../../components/DeepField"
                        }
                    }
                }
            };
        `;
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.code).toContain('import("../../components/DeepField")');
        expect((result!.code.match(/__rebaseLazy/g) || []).length).toBe(1);
    });

    // ── Sourcemap ────────────────────────────────────────────────────

    it("returns a sourcemap with the transform result", () => {
        const transform = createTransform();
        const input = 'const c = { Field: "../../components/MyField" };';
        const result = transform(input);
        expect(result).not.toBeNull();
        expect(result!.map).toBeDefined();
        expect(result!.map).not.toBeNull();
    });
});

describe("transformCollectionSource — unit tests", () => {

    it("returns null when there are no matches", () => {
        const result = transformCollectionSource(
            'const x = "hello";',
            "test.ts"
        );
        expect(result).toBeNull();
    });

    it("replaces only the string literal, preserving surrounding code", () => {
        const code = `const c = { Field: "./MyField", name: "test" };`;
        const result = transformCollectionSource(code, "test.ts");
        expect(result).not.toBeNull();
        expect(result!.code).toBe(
            `const c = { Field: { __rebaseLazy: true, load: () => import("./MyField") }, name: "test" };`
        );
    });

    it("transforms only within real object assignments, not bare strings", () => {
        const code = `const s = "./components/MyField";`;
        const result = transformCollectionSource(code, "test.ts");
        expect(result).toBeNull();
    });

    it("does not transform computed property names", () => {
        const code = `const c = { ["Field"]: "./MyField" };`;
        const result = transformCollectionSource(code, "test.ts");
        expect(result).toBeNull();
    });
});
