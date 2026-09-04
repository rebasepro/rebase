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
                        admin: {
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
                        admin: {
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
        // An empty or placeholder map object is "defined" and "not null" too,
        // and Vite would accept it and then point every stack frame at the
        // wrong line. The mappings are the part that does the work.
        expect(result!.map).toMatchObject({
            version: 3,
            mappings: expect.stringMatching(/.+/)
        });
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

/**
 * The virtual module is emitted as a *string*, so nothing typechecks it — a
 * syntax error there ships and only fails in a user's browser build. These
 * execute the emitted code.
 */
describe("rebaseCollectionsPlugin — virtual collections module", () => {
    function emit(collectionsDir = "/project/config/collections"): string {
        const plugin = rebaseCollectionsPlugin({ collectionsDir });
        (plugin as { configResolved: (c: { root: string }) => void }).configResolved({ root: "/project" });
        const id = (plugin as { resolveId: (s: string) => string | undefined }).resolveId("virtual:rebase-collections");
        return (plugin as { load: (id: string) => string | null }).load(id as string) as string;
    }

    /** Run the emitted module with a stubbed `import.meta.glob`. */
    function run(source: string, modules: Record<string, unknown>): { collections: Record<string, unknown>[] } {
        const body = source
            .replace("import.meta.glob(", "__glob(")
            .replace(/export const collections =/, "const collections =");
        const fn = new Function("__glob", `${body}; return { collections };`);
        return fn(() => modules) as { collections: Record<string, unknown>[] };
    }

    it("emits syntactically valid JavaScript", () => {
        expect(() => run(emit(), {})).not.toThrow();
    });

    it("collects the default export of every collection file", () => {
        const { collections } = run(emit(), {
            "/project/config/collections/posts.ts": { default: { slug: "posts" } },
            "/project/config/collections/authors.ts": { default: { slug: "authors" } }
        });

        expect(collections.map((c) => c.slug).sort()).toEqual(["authors", "posts"]);
    });

    it("drops index, which exports defaults rather than a collection", () => {
        const { collections } = run(emit(), {
            "/project/config/collections/posts.ts": { default: { slug: "posts" } },
            "/project/config/collections/index.ts": { collections: [], defaultSecurityRules: [] }
        });

        expect(collections.map((c) => c.slug)).toEqual(["posts"]);
    });

    it("applies defaultSecurityRules from index, matching the backend loader", () => {
        // Otherwise the admin shows a collection as unprotected while the
        // database enforces the rules it inherited.
        const defaults = [{ operation: "select", access: "public" }];
        const { collections } = run(emit(), {
            "/project/config/collections/posts.ts": { default: { slug: "posts" } },
            "/project/config/collections/index.ts": { defaultSecurityRules: defaults }
        });

        expect(collections[0].securityRules).toEqual(defaults);
    });

    it("never overrides a collection's own rules", () => {
        const own = [{ operation: "all", roles: ["admin"] }];
        const { collections } = run(emit(), {
            "/project/config/collections/posts.ts": { default: { slug: "posts", securityRules: own } },
            "/project/config/collections/index.ts": { defaultSecurityRules: [{ operation: "select", access: "public" }] }
        });

        expect(collections[0].securityRules).toEqual(own);
    });

    it("leaves rules unset when index declares no defaults", () => {
        const { collections } = run(emit(), {
            "/project/config/collections/posts.ts": { default: { slug: "posts" } }
        });

        expect(collections[0].securityRules).toBeUndefined();
    });
});

/**
 * `config/collections/*.ts` is shared between the backend, which loads it from
 * disk, and the admin bundle, which this plugin globs the same directory into.
 * So everything in those files shipped to every visitor: in the example app's
 * own built bundle you could read the compiled `beforeSave:({values:e` and the
 * raw policy string beside it.
 *
 * The strip is total: `callbacks` is the server's block, every key of it, and a
 * callback added to the type later is stripped without anyone remembering to
 * come back here. `afterRead` and `afterSave` used to be exempt on the grounds
 * that the panel ran them; the panel's own callbacks now live under
 * `admin.browserCallbacks`, which is a different key and stays.
 */
describe("server callbacks are stripped from the browser bundle", () => {
    const wrap = (callbacks: string) =>
        `const c = { slug: "posts", callbacks: { ${callbacks} } };`;

    it.each(["beforeSave", "beforeDelete", "afterDelete", "afterSaveError", "afterRead", "afterSave"])(
        "drops the body of %s", (hook) => {
            const transform = createTransform();
            const result = transform(wrap(`${hook}: async ({ values }) => { await chargeCard(values, process.env.STRIPE_KEY); return values; }`));
            expect(result).not.toBeNull();
            expect(result!.code).toContain(`${hook}: undefined`);
            expect(result!.code).not.toContain("chargeCard");
            expect(result!.code).not.toContain("STRIPE_KEY");
        });

    it("keeps `admin.browserCallbacks`, which is the panel's own block", () => {
        const transform = createTransform();
        // The whole point of the second key: what runs where is decided by which
        // block it was written in, and the plugin can see that in one file. It
        // cannot see a `dataSources` declaration in another one.
        const result = transform(
            'const c = { slug: "posts", admin: { browserCallbacks: { afterRead: async ({ row }) => decorate(row) } } };');
        expect(result).toBeNull();
    });

    it("strips the server block and keeps the browser one in the same collection", () => {
        const transform = createTransform();
        const result = transform(
            'const c = { callbacks: { afterRead: ({ row }) => mask(row, process.env.SALT) },' +
            ' admin: { browserCallbacks: { afterRead: ({ row }) => decorate(row) } } };');
        expect(result!.code).toContain("afterRead: undefined");
        expect(result!.code).toContain("afterRead: ({ row }) => decorate(row)");
        expect(result!.code).not.toContain("SALT");
    });

    it("keeps the key so the comma structure and every other callback survive", () => {
        const transform = createTransform();
        const result = transform(wrap(
            "beforeSave: (p) => p, afterDelete: async ({ row }) => audit(row)"));
        expect(result!.code).toContain("beforeSave: undefined");
        expect(result!.code).toContain("afterDelete: undefined");
        expect(result!.code).not.toContain("audit(row)");
    });

    it("strips a callback key that did not exist when this was written", () => {
        // No allowlist to fall out of date. The previous version named four
        // keys, and the two it left out were both wrong in different ways —
        // a seventh callback would have shipped for the same reason.
        const transform = createTransform();
        const result = transform(wrap("beforeArchive: async () => callVendor(process.env.VENDOR_KEY)"));
        expect(result!.code).toContain("beforeArchive: undefined");
        expect(result!.code).not.toContain("VENDOR_KEY");
    });

    it("strips property-level callbacks too, which are also server-only", () => {
        const transform = createTransform();
        const result = transform(
            'const c = { properties: { price: { type: "number", callbacks: { beforeSave: ({ value }) => secretRound(value) } } } };');
        expect(result!.code).toContain("beforeSave: undefined");
        expect(result!.code).not.toContain("secretRound");
    });

    it("leaves a `beforeSave` that is not a lifecycle hook alone", () => {
        const transform = createTransform();
        // Same name, not inside a `callbacks` block — must not be touched.
        const result = transform('const c = { admin: { beforeSave: "a label" } };');
        expect(result).toBeNull();
    });
});
