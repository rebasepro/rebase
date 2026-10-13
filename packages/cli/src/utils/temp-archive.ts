/**
 * Temporary archives, each in a directory no other run shares.
 *
 * A name built from `Date.now()` is shared by every run started in the same
 * millisecond — two deploys in parallel CI jobs, two vitest workers — and the
 * first run to finish removed the archive the other was still packing or
 * uploading. `mkdtemp` creates the directory atomically under a random suffix,
 * so a path inside it belongs to this run alone.
 */
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Run `work` with a path for `<prefix>.tar.gz` inside a fresh temporary
 * directory, and remove that directory however the run ends.
 *
 * "However" includes `process.exit`: a `fail()` inside `work` ends the process
 * on the spot, and no `finally` runs after that, so the directory is removed on
 * the process's `exit` event as well.
 */
export async function withTempArchive<T>(prefix: string, work: (archivePath: string) => Promise<T>): Promise<T> {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
    const remove = (): void => fs.rmSync(dir, { recursive: true, force: true });
    process.on("exit", remove);
    try {
        return await work(path.join(dir, `${prefix}.tar.gz`));
    } finally {
        process.off("exit", remove);
        remove();
    }
}
