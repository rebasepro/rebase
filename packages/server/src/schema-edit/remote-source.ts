/**
 * Rewriting a collection whose source is not on this machine.
 *
 * A bundle deployment — every Cloud tenant, and any self-host running built
 * output — ships *compiled* collections. The AST editor rewrites the
 * TypeScript, opening it from a directory on disk, so there is nothing for it
 * to open. That single fact is why live schema editing was local-only: not
 * authentication, not the Git Data API, which have worked for a while, but the
 * editor needing a file.
 *
 * So the file is brought to it. Read the current source from the repository,
 * put it in a scratch directory shaped the way the editor expects, let the
 * editor do exactly what it does locally, and read the result back. The editor
 * is unchanged and untouched — which matters, because it is the part that knows
 * how to preserve a collection file's imports, comments and formatting, and a
 * second implementation of that for the remote case would be a second thing to
 * get wrong.
 *
 * ## What the scratch directory holds
 *
 * One file: the collection being edited. Not the whole directory.
 *
 * The editor resolves `<dir>/<id>.ts` and rewrites it in place; it does not
 * read its siblings to do that. Fetching them all would be a request per
 * collection on every save, for files nothing reads. A collection that does not
 * exist yet is simply absent, which is the same state the editor sees locally
 * when somebody adds one.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SchemaChangeFile } from "@rebasepro/types";
import type { SchemaEditRepository } from "./apply-schema-change";

export interface RemoteSourceOptions {
    repository: SchemaEditRepository;
    /**
     * Where the collection *source* lives in the repository, as a repo-relative
     * posix path — `config/collections`, or `app/config/collections` for a
     * project in a subdirectory.
     *
     * Not derivable from the bundle: its `collectionsDir` points at compiled
     * output, which is a different directory holding different files.
     */
    collectionsPath: string;
    /** Applies the edit. Injected so this module needs no `ts-morph`. */
    edit: (collectionsDir: string, collectionId: string, collection: Record<string, unknown>) => Promise<void>;
}

/**
 * Fetch, rewrite, and return the changed file — without leaving anything behind.
 *
 * The scratch directory is removed on every path, including the failing one. It
 * holds a copy of the customer's collection source, and a temp directory that
 * accumulates those on a long-running server is a slow leak of exactly the
 * thing worth not leaking.
 */
export async function rewriteRemoteCollection(
    options: RemoteSourceOptions,
    collectionId: string,
    collection: Record<string, unknown>
): Promise<SchemaChangeFile[]> {
    const { repository, collectionsPath, edit } = options;

    if (!repository.readFile) {
        throw new Error(
            "This repository cannot read a file, so the collection source cannot be rewritten " +
            "for a deployment that has none on disk."
        );
    }

    const repoPath = `${collectionsPath.replace(/\/+$/, "")}/${collectionId}.ts`;
    const existing = await repository.readFile(repoPath);

    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "rebase-remote-source-"));
    try {
        if (existing !== undefined) {
            await fs.writeFile(path.join(scratch, `${collectionId}.ts`), existing, "utf8");
        }

        await edit(scratch, collectionId, collection);

        const written = await fs.readFile(path.join(scratch, `${collectionId}.ts`), "utf8");
        return [{ path: repoPath, contents: written }];
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
}
