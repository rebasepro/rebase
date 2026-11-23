import fs from "fs";
import path from "path";

/**
 * The `@rebasepro/cli` a project installed, found the way Node finds it: the
 * nearest `node_modules/@rebasepro/cli` from the project root up.
 *
 * For running a command with the CLI the project now pins rather than the one
 * already running. After `rebase upgrade` installs, this process is still the
 * old release — its code is loaded, and the skills it would copy are the ones
 * it shipped with. The project's install is the new one.
 *
 * `bin/rebase.js` does the same lookup for its own hand-off from a checkout;
 * that file runs before the bundle loads and cannot import this.
 */
export function projectCli(projectRoot: string): { bin: string; version: string } | null {
    let dir = path.resolve(projectRoot);
    for (;;) {
        const manifestPath = path.join(dir, "node_modules", "@rebasepro", "cli", "package.json");
        if (fs.existsSync(manifestPath)) {
            try {
                const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
                if (!manifest || typeof manifest !== "object") return null;
                const { bin, version } = manifest as { bin?: unknown; version?: unknown };
                const binPath = typeof bin === "string"
                    ? bin
                    : bin && typeof bin === "object" && "rebase" in bin && typeof bin.rebase === "string"
                        ? bin.rebase
                        : undefined;
                if (binPath === undefined) return null;
                const resolved = path.join(path.dirname(manifestPath), binPath);
                if (!fs.existsSync(resolved)) return null;
                return { bin: resolved, version: typeof version === "string" ? version : "unknown" };
            } catch {
                return null;
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) return null;
        dir = parent;
    }
}
