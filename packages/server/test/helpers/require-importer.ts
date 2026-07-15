import { fileURLToPath } from "url";
import type { ModuleImporter } from "../../src/utils/dynamic-import";

/**
 * Deterministic {@link ModuleImporter} for tests.
 *
 * The loaders default to a native ESM `import()`, which races under jest's
 * `--experimental-vm-modules` when many test files run across parallel workers
 * (intermittent empty results). Tests inject this CommonJS `require`-based
 * importer instead: it loads the committed CJS fixtures synchronously and
 * deterministically, and returns the same `{ default }` shape Node's ESM
 * interop exposes for a CommonJS module — so the loader logic under test is
 * exercised identically, just without the flaky native-import timing.
 */
export const requireImporter: ModuleImporter = async (url: string) => {
    const filePath = fileURLToPath(url);
    // Load fresh so repeated loads in a suite don't return a stale cached copy.
    delete require.cache[require.resolve(filePath)];
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- deterministic CJS load of committed fixtures, replacing the flaky native import in tests
    const mod = require(filePath);
    return { default: mod && mod.default !== undefined ? mod.default : mod };
};
