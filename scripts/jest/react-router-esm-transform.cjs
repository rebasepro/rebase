/**
 * Downlevels the ESM-only packages in react-router 8's graph to CommonJS so the
 * ts-jest suites can load them. Two separate problems, one per file extension.
 *
 * `.js` — react-router's SSR route-module helper guards a Vite HMR hook with
 * `import.meta.hot`. Jest evaluates transformed output as CommonJS, where
 * `import.meta` is a hard *syntax* error, so every suite that so much as
 * imports `MemoryRouter` fails to load before a single assertion runs. ts-jest
 * alone does not save us: TypeScript emits `import.meta` verbatim under
 * `module: commonjs` (it reports TS1343 and passes the expression through), so
 * we strip it from the output. Under Jest there is no Vite HMR context, so
 * `undefined` is exactly what the guard would have evaluated to.
 *
 * `.mjs` — react-router depends on cookie-es 3, which ships `.mjs` only, with
 * no CJS build to resolve to instead. TypeScript keys module format off the
 * file extension and will not emit CJS for a `.mjs` input whatever `module`
 * says, so ts-jest cannot help here at all; we transpile those directly,
 * handing TypeScript a `.js` filename so it emits CommonJS.
 *
 * The packages' own `.ts`/`.tsx` keep using plain ts-jest. This is reachable
 * from a package only if its `transformIgnorePatterns` lifts the relevant
 * packages out of the blanket `node_modules` exclusion.
 */
const ts = require("typescript");
const { createTransformer } = require("ts-jest").default;

// Bump when the rewriting below changes, so Jest's transform cache is not
// reused across a change in what we emit.
const FIXUP_VERSION = "1";

const IMPORT_META_HOT = /import\.meta\.hot/g;

/**
 * Jest looks for a `createTransformer` factory on the module it is pointed at.
 * @param {unknown} options
 */
function createReactRouterEsmTransformer(options) {
    const inner = createTransformer({
        // react-router ships plain JS; without allowJs ts-jest refuses the file.
        tsconfig: { allowJs: true, module: "commonjs", target: "es2022" },
        diagnostics: false,
        ...(options || {})
    });

    return {
        ...inner,

        process(sourceText, sourcePath, transformOptions) {
            if (sourcePath.endsWith(".mjs")) {
                // The `.js` filename is the point: it is what makes TypeScript
                // emit CommonJS instead of preserving the ES module.
                const { outputText } = ts.transpileModule(sourceText, {
                    compilerOptions: {
                        module: ts.ModuleKind.CommonJS,
                        target: ts.ScriptTarget.ES2022,
                        allowJs: true
                    },
                    fileName: sourcePath.replace(/\.mjs$/, ".js")
                });
                return { code: outputText.replace(IMPORT_META_HOT, "undefined") };
            }

            const result = inner.process(sourceText, sourcePath, transformOptions);
            if (typeof result.code === "string" && result.code.includes("import.meta")) {
                return { ...result, code: result.code.replace(IMPORT_META_HOT, "undefined") };
            }
            return result;
        },

        getCacheKey(sourceText, sourcePath, transformOptions) {
            return `${inner.getCacheKey(sourceText, sourcePath, transformOptions)}:rr-esm-${FIXUP_VERSION}`;
        }
    };
}

module.exports = { createTransformer: createReactRouterEsmTransformer };
