import { createRequire } from "module";
import path from "path";
import { pathToFileURL } from "url";

/**
 * tsx's loader, as the URL `node --import` takes, or null when none resolves.
 *
 * For running one of this driver's scripts in one Node process. The `tsx`
 * binary is a relay — pnpm's `.bin/tsx` shell shim, then tsx's CLI in one Node,
 * which spawns a second Node with this same loader to run the script — so
 * spawning through it costs a shell and a Node start (~50–100 ms) per child.
 *
 * Resolved the way Node resolves the package: from the project the driver
 * runs in first (its cwd is the backend, where a scaffold declares tsx), then
 * from this package. A URL rather than a path: a Windows path is not a valid
 * `--import` specifier.
 */
export function resolveTsxLoader(): string | null {
    const bases = [path.join(process.cwd(), "noop.js"), import.meta.url];
    for (const base of bases) {
        try {
            return pathToFileURL(createRequire(base).resolve("tsx")).href;
        } catch {
            // Not resolvable from here; try the next base.
        }
    }
    return null;
}
