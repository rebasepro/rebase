import type { AstSchemaEditor } from "../api/ast-schema-editor";

/**
 * The process's editor of the collection source files, one edit at a time.
 *
 * Two routers rewrite those files: the source-only editor
 * (`/api/schema-editor/*`) and live schema editing's `/apply`. Both go through
 * this one {@link AstSchemaEditor}, so the ts-morph project over the
 * collections directory is parsed once per process rather than once per
 * apply — 180–250 ms of blocked event loop at 200 collection files, on every
 * save. The editor re-reads the disk at the start of each edit
 * (`syncWithDisk`): a file changed since — by the IDE, by a commit being put
 * back — is refreshed, a new one is added, a deleted one is dropped.
 *
 * One project cannot take two edits at once. An edit holds unsaved changes in
 * memory across `await project.save()`, and a second edit arriving meanwhile
 * would refresh those files from disk under it, or save them with its own.
 * So every edit, from either router, waits in one queue for the edits before
 * it to settle — a refused one included — and anything an edit does with the
 * files it wrote (reading them back for a commit) belongs inside the same
 * {@link run}, before the next edit can touch them.
 */
export class SchemaSourceEditor {
    private settled: Promise<unknown> = Promise.resolve();

    constructor(private readonly editor: AstSchemaEditor) {
    }

    /** Run `edit` once every edit queued before it has finished. */
    run<T>(edit: (editor: AstSchemaEditor) => Promise<T>): Promise<T> {
        const result = this.settled.then(() => edit(this.editor));
        this.settled = result.then(() => undefined, () => undefined);
        return result;
    }
}
