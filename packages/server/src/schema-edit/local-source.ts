/**
 * Writing a live schema change into the collection source on this machine.
 *
 * `ts-morph` is what knows how to keep a collection file's imports, comments
 * and formatting, so every edit goes through the AST editor — here through the
 * process's one {@link SchemaSourceEditor}, the same the source-only editor
 * routes use, rather than a project parsed afresh for every apply.
 */
import nodeFs from "node:fs/promises";
import nodePath from "node:path";

import type { CollectionPatch, SchemaChangeFile } from "@rebasepro/types";
import type { AstSchemaEditor } from "../api/ast-schema-editor";
import type { SchemaSourceEditor } from "./source-editor";

/** What a change asks of a collection file: a patch for one that exists, the whole of a new one. */
export interface CollectionSourceEdit {
    collection?: Record<string, unknown>;
    patch?: CollectionPatch;
}

/**
 * Apply the edit the one way it is implemented. An existing collection arrives
 * as a patch — what the person changed — and only those keys are written; a
 * new one arrives whole.
 */
export async function editCollectionSource(
    editor: AstSchemaEditor,
    collectionId: string,
    edit: CollectionSourceEdit
): Promise<void> {
    if (edit.patch) await editor.applyPatch(collectionId, edit.patch);
    else await editor.saveCollection(collectionId, edit.collection ?? {}, { partial: false });
}

/**
 * Write the change into `collectionsDir` and return what it wrote, as paths
 * relative to the repository root, for the commit.
 *
 * A removal deletes the file and edits `index.ts`; both go in the commit, the
 * file as a deletion. The files are read back inside the same queued edit, so
 * what is committed is this change's result and no later edit's.
 */
export function writeLocalCollectionSource(
    source: SchemaSourceEditor,
    where: { collectionsDir: string; repositoryRoot: string },
    change: CollectionSourceEdit & { collectionId: string; remove?: boolean }
): Promise<SchemaChangeFile[]> {
    const relative = (file: string) => nodePath.relative(where.repositoryRoot, file);
    return source.run(async (editor) => {
        if (change.remove) {
            const { deleted, changed } = await editor.deleteCollection(change.collectionId);
            return [
                {
                    path: relative(deleted),
                    contents: "",
                    deleted: true
                },
                ...await Promise.all(changed.map(async file => ({
                    path: relative(file),
                    contents: await nodeFs.readFile(file, "utf8")
                })))
            ];
        }

        await editCollectionSource(editor, change.collectionId, change);

        // Read back what it wrote. The editor resolves
        // `<collectionsDir>/<id>.ts`, and the commit needs the contents rather
        // than a promise that a file changed.
        const file = nodePath.join(where.collectionsDir, `${change.collectionId}.ts`);
        return [{
            path: relative(file),
            contents: await nodeFs.readFile(file, "utf8")
        }];
    });
}
