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
 * So the files are brought to it. Read the current source from the repository,
 * put it in a scratch directory shaped the way the editor expects, let the
 * editor do exactly what it does locally, and read the result back. The editor
 * is unchanged and untouched — which matters, because it is the part that knows
 * how to preserve a collection file's imports, comments and formatting, and a
 * second implementation of that for the remote case would be a second thing to
 * get wrong.
 *
 * ## What the scratch directory holds
 *
 * The whole collections directory, when the repository can list it. The editor
 * reads a collection's siblings for two things: a relation picked by slug
 * imports the target's file (with one file present that threw "no file for it
 * in <tmp>"), and a deletion refuses while another file imports the one going
 * and takes it out of `index.ts`. A save is a person pressing a button, so a
 * read per collection file is cheap next to committing a relation that does not
 * resolve.
 *
 * A repository that cannot list gets the one file being edited, as before. That
 * is enough for an edit that touches no other collection; a deletion is refused
 * there, because without the siblings nothing can tell whether the project
 * would still load.
 *
 * What comes back is exactly what the editor changed — edited files, new
 * files, deletions — and the edited collection's file always, so the commit
 * names it even when the edit left it byte-identical.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SchemaChangeFile } from "@rebasepro/types";
import type { SchemaEditRepository } from "./apply-schema-change";

/**
 * At most this many collection files are brought over.
 *
 * A collections directory holds tens of files. One holding thousands is not a
 * collections directory — a mis-set `collectionsPath` pointing at the repository
 * root, say — and reading every file in it on each save is the wrong thing to
 * do quietly.
 */
export const MAX_REMOTE_COLLECTION_FILES = 500;

export interface RemoteSourceOptions<Edit = Record<string, unknown>> {
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
    /**
     * Applies the edit. Injected so this module needs no `ts-morph`.
     *
     * `edit` is whatever the caller's editor takes — a whole collection, the
     * patch of what changed about an existing one, or a removal — passed
     * through untouched.
     */
    edit: (collectionsDir: string, collectionId: string, edit: Edit) => Promise<void>;
}

/** `repoPath` inside `scratch`, refusing anything that would land outside it. */
function scratchPathFor(scratch: string, root: string, repoPath: string): string {
    const relative = repoPath.slice(root.length + 1);
    const resolved = path.resolve(scratch, ...relative.split("/"));
    if (!repoPath.startsWith(`${root}/`) || !resolved.startsWith(scratch + path.sep)) {
        throw new Error(`Refusing the repository path "${repoPath}": it resolves outside the collections directory.`);
    }
    return resolved;
}

/** Every `.ts` file under `dir`, as posix paths relative to it. */
async function walk(dir: string, prefix = ""): Promise<string[]> {
    const found: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) found.push(...await walk(path.join(dir, entry.name), relative));
        else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(relative);
    }
    return found;
}

/** The current source: the whole directory when the repository can list it, else the one file. */
async function fetchSources(
    repository: SchemaEditRepository,
    root: string,
    target: string
): Promise<{ sources: Map<string, string>; complete: boolean }> {
    const read = repository.readFile!.bind(repository);
    if (!repository.listFiles) {
        const existing = await read(target);
        return {
            sources: new Map(existing === undefined ? [] : [[target, existing]]),
            complete: false
        };
    }

    const listed = (await repository.listFiles(root)).filter(file => file.endsWith(".ts"));
    if (listed.length > MAX_REMOTE_COLLECTION_FILES) {
        throw new Error(
            `${root} holds ${listed.length} TypeScript files, more than the ${MAX_REMOTE_COLLECTION_FILES} ` +
            "a collections directory is expected to. Check `collectionsPath` " +
            "(REBASE_LIVE_SCHEMA_COLLECTIONS_PATH) points at the collection source."
        );
    }
    const contents = await Promise.all(listed.map(async file => [file, await read(file)] as const));
    return {
        sources: new Map(contents.filter((entry): entry is readonly [string, string] => entry[1] !== undefined)),
        complete: true
    };
}

/**
 * Fetch, rewrite, and return the changed files — without leaving anything behind.
 *
 * The scratch directory is removed on every path, including the failing one. It
 * holds a copy of the customer's collection source, and a temp directory that
 * accumulates those on a long-running server is a slow leak of exactly the
 * thing worth not leaking.
 */
export async function rewriteRemoteCollection<Edit>(
    options: RemoteSourceOptions<Edit>,
    collectionId: string,
    change: Edit
): Promise<SchemaChangeFile[]> {
    const { repository, edit } = options;

    if (!repository.readFile) {
        throw new Error(
            "This repository cannot read a file, so the collection source cannot be rewritten " +
            "for a deployment that has none on disk."
        );
    }

    const root = options.collectionsPath.replace(/\/+$/, "");
    const target = `${root}/${collectionId}.ts`;

    const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "rebase-remote-source-")));
    try {
        const { sources, complete } = await fetchSources(repository, root, target);
        for (const [repoPath, contents] of sources) {
            const local = scratchPathFor(scratch, root, repoPath);
            await fs.mkdir(path.dirname(local), { recursive: true });
            await fs.writeFile(local, contents, "utf8");
        }

        await edit(scratch, collectionId, change);

        const after = new Map<string, string>();
        for (const relative of await walk(scratch)) {
            after.set(`${root}/${relative}`, await fs.readFile(path.join(scratch, ...relative.split("/")), "utf8"));
        }

        const files: SchemaChangeFile[] = [];
        for (const [repoPath, contents] of after) {
            if (repoPath === target || sources.get(repoPath) !== contents) {
                files.push({ path: repoPath, contents });
            }
        }
        for (const repoPath of sources.keys()) {
            if (after.has(repoPath)) continue;
            if (!complete) {
                throw new Error(
                    `Deleting "${collectionId}" needs every collection file, to check nothing imports it ` +
                    "and to take it out of index.ts, and this repository cannot list a directory."
                );
            }
            files.push({ path: repoPath, contents: "", deleted: true });
        }

        // The edited collection first, then the rest in path order: the commit
        // and the receipt read the same either way, and a test can say what it
        // expects.
        return files.sort((a, b) =>
            a.path === target ? -1 : b.path === target ? 1 : a.path.localeCompare(b.path));
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
}
