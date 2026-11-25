/**
 * The skills catalog's storage over a folder on disk (`mcp-skills.ts`).
 *
 * Node-only, so it is imported at boot — never from the request path, which
 * `mcp-skills.ts` and `mcp-routes.ts` sit on (`contracts/portable-core.txt`).
 *
 * @module
 */
import { constants } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";
import type { McpSkillFileEntry, McpSkillFiles } from "./mcp-skills.js";

/**
 * A {@link McpSkillFiles} over `root`. Symlinks and other special files are
 * reported `unsupported`, so the skill holding one is not served; `read`
 * refuses anything but a regular file, and does not follow a symlink as the
 * last part of a path. A path that would leave `root` throws.
 */
export function nodeSkillFiles(root: string): McpSkillFiles {
    const base = path.resolve(root);
    const within = (relative: string): string => {
        if (relative === "") return base;
        const segments = relative.split("/");
        if (segments.some(segment => segment === "" || segment === "." || segment === ".." || segment.includes(path.sep))) {
            throw new TypeError(`Not a path inside the skills folder: ${JSON.stringify(relative)}`);
        }
        return path.join(base, ...segments);
    };
    return {
        async list(dir: string): Promise<McpSkillFileEntry[]> {
            const entries = await readdir(within(dir), { withFileTypes: true });
            return entries.map(entry => ({
                name: entry.name,
                kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "unsupported"
            }));
        },
        async read(relative: string): Promise<Uint8Array> {
            const handle = await open(within(relative), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
                if (!(await handle.stat()).isFile()) throw new Error(`${relative} is not a regular file`);
                const buffer = await handle.readFile();
                return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            } finally {
                await handle.close();
            }
        }
    };
}
