import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * This CLI's own version, and the User-Agent built from it.
 *
 * Three call sites used to answer "what version am I?" and each answered it
 * differently: `cli.ts` walked one directory up from `__dirname`, `init.ts`
 * walked up looking for a folder literally named `cli`, and every HTTP request
 * to the control plane answered it not at all. The last one is the expensive
 * gap — the control plane cannot refuse a CLI that is too old for its wire
 * format if no request ever says which CLI is calling.
 *
 * Resolved by walking up for the manifest that actually names this package,
 * rather than by counting directories or matching a folder name: `dist/` is one
 * level down in a published install and two in a source checkout, and a folder
 * named `cli` is not guaranteed to be ours.
 */
function readVersion(): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    const root = path.parse(dir).root;
    while (dir && dir !== root) {
        const manifest = path.join(dir, "package.json");
        if (fs.existsSync(manifest)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(manifest, "utf-8"));
                if (pkg.name === "@rebasepro/cli" && typeof pkg.version === "string") return pkg.version;
            } catch {
                // A malformed manifest on the way up is not ours to complain
                // about; keep walking.
            }
        }
        dir = path.dirname(dir);
    }
    return "unknown";
}

let cached: string | undefined;

/** The CLI's version, or `"unknown"` when it cannot be read. Memoized. */
export function cliVersion(): string {
    if (cached === undefined) cached = readVersion();
    return cached;
}

/**
 * `rebase-cli/0.17.3` — sent on every control-plane request.
 *
 * The control plane needs it to answer `CLI_TOO_OLD` with a minimum version
 * instead of failing somewhere further in with a shape error. A client that
 * does not identify itself can only ever be refused generically.
 */
export function cliUserAgent(): string {
    return `rebase-cli/${cliVersion()}`;
}
