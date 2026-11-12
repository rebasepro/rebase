/**
 * Writing the planned files so that a failed verification leaves nothing
 * behind.
 *
 * The migrated modules have to be verified where they will live: their
 * relative imports point at the project's own files, and their bare imports
 * (`@rebasepro/server/schema`) resolve through the backend workspace's
 * `node_modules`, which a temporary directory elsewhere cannot see. So the
 * files are written in place under a journal — every created file and
 * directory recorded, every replaced file's previous content kept — and
 * {@link Journal.rollback} restores the tree exactly when verification fails.
 */
import fs from "node:fs";
import path from "node:path";

/** What was written, so it can be undone. */
export class Journal {
    private readonly created: string[] = [];
    private readonly createdDirs: string[] = [];
    private readonly replaced = new Map<string, Buffer>();

    /** Write one file, recording what was there before. */
    write(file: string, content: string): void {
        const dir = path.dirname(file);
        const missing: string[] = [];
        let current = dir;
        while (!fs.existsSync(current)) {
            missing.unshift(current);
            current = path.dirname(current);
        }
        for (const created of missing) {
            fs.mkdirSync(created);
            this.createdDirs.push(created);
        }
        if (fs.existsSync(file)) {
            if (!this.replaced.has(file) && !this.created.includes(file)) this.replaced.set(file, fs.readFileSync(file));
        } else if (!this.created.includes(file)) {
            this.created.push(file);
        }
        fs.writeFileSync(file, content);
    }

    /** Put every file and directory back as it was. */
    rollback(): void {
        for (const file of [...this.created].reverse()) fs.rmSync(file, { force: true });
        for (const [file, content] of this.replaced) fs.writeFileSync(file, content);
        for (const dir of [...this.createdDirs].reverse()) {
            try {
                fs.rmdirSync(dir);
            } catch {
                // Not empty: something else lives there now. Leave it.
            }
        }
        this.created.length = 0;
        this.createdDirs.length = 0;
        this.replaced.clear();
    }
}
