/**
 * Shape returned by a dynamic module import: an object whose `default`
 * property holds the module's default export (CJS `module.exports` is exposed
 * as `default` by Node's ESM interop).
 */
export interface ImportedModule {
    default?: unknown;
    [key: string]: unknown;
}

/**
 * Imports a module by file URL. Injected into the directory loaders so tests
 * can supply a deterministic importer.
 */
export type ModuleImporter = (url: string) => Promise<ImportedModule>;

/**
 * Native ESM dynamic import.
 *
 * Wrapped in `new Function` so TypeScript / bundlers don't down-compile the
 * `import()` to `require()` — the loaders must import user-authored `.ts`/`.js`
 * files at runtime using the host's real ESM loader. This is the production
 * default for {@link loadFunctionsFromDirectory} / {@link loadCronJobsFromDirectory}.
 *
 * @internal
 */
export const nativeDynamicImport: ModuleImporter = (() => {
    const doImport = new Function("url", "return import(url)") as (url: string) => Promise<ImportedModule>;
    return (url: string) => doImport(url);
})();
