/**
 * Editing a schema whose source is not on this machine.
 *
 * A bundle deployment — every Cloud tenant, and any self-host running built
 * output — ships *compiled* tables. The schema editor rewrites the
 * TypeScript of `backend/schema`, so the files are brought to it: the whole
 * schema directory is read from the repository into a scratch directory, the
 * editor previews the edit there exactly as it does locally (rewriting and
 * compiling), and what it changed comes back as repository paths for the
 * commit. The editor is the one implementation of preserving a table file's
 * imports, comments and formatting; a second one for the remote case would be
 * a second thing to get wrong.
 *
 * The whole directory, not only the edited file: the edit is compiled before
 * it is committed, and compiling reads every module the index exports — a
 * relation's target, the index itself. A repository that cannot list a
 * directory cannot be edited this way, and is refused.
 *
 * The scratch directory is removed on every path, the failing one included:
 * it holds a copy of the customer's schema source.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { SchemaChangeFile } from "@rebasepro/types";
import type { SchemaEditRepository } from "./apply-schema-change";

/**
 * At most this many files are brought over.
 *
 * A schema directory holds tens of files. One holding thousands is not a
 * schema directory — a mis-set `schemaPath` pointing at the repository root,
 * say — and reading every file in it on each save is the wrong thing to do
 * quietly.
 */
export const MAX_REMOTE_SCHEMA_FILES = 500;

/** The files a schema module may be. */
const MODULE = /\.(ts|mts|js|mjs|json)$/;

/** A preview made in a scratch directory: the files it changed, and whatever else the editor answered. */
export interface ScratchEdit<Result> {
    /** Every file the edit changed, by its absolute path in the scratch directory. */
    files: { path: string; contents: string; deleted?: true }[];
    result: Result;
}

/**
 * Options of {@link previewRemoteSchema}.
 */
export interface RemoteSchemaOptions<Result> {
    repository: SchemaEditRepository;
    /**
     * Where the schema source lives in the repository, as a repo-relative posix
     * path — `backend/schema`, or `app/backend/schema` for a project in a
     * subdirectory. Not derivable from the bundle, whose tables are compiled
     * output.
     */
    schemaPath: string;
    /** Preview the edit over the scratch directory. Injected so this module needs no `ts-morph`. */
    preview: (dir: string) => Promise<ScratchEdit<Result>>;
}

/** `repoPath` inside `scratch`, refusing anything that would land outside it. */
function scratchPathFor(scratch: string, root: string, repoPath: string): string {
    const relative = repoPath.slice(root.length + 1);
    const resolved = path.resolve(scratch, ...relative.split("/"));
    if (!repoPath.startsWith(`${root}/`) || !resolved.startsWith(scratch + path.sep)) {
        throw new Error(`Refusing the repository path "${repoPath}": it resolves outside the schema directory.`);
    }
    return resolved;
}

/**
 * Fetch the schema directory, preview the edit over it, and return what
 * changed as repository paths — without leaving anything behind.
 */
export async function previewRemoteSchema<Result>(
    options: RemoteSchemaOptions<Result>
): Promise<{ files: SchemaChangeFile[]; result: Result }> {
    const { repository } = options;
    if (!repository.readFile || !repository.listFiles) {
        throw new Error(
            "This repository cannot list a directory and read its files, so the schema source cannot be edited " +
            "for a deployment that has none on disk: the edit is compiled against the whole schema directory."
        );
    }
    const root = options.schemaPath.replace(/\/+$/, "");
    const listed = (await repository.listFiles(root)).filter(file => MODULE.test(file));
    if (listed.length > MAX_REMOTE_SCHEMA_FILES) {
        throw new Error(
            `${root} holds ${listed.length} module files, more than the ${MAX_REMOTE_SCHEMA_FILES} a schema directory ` +
            "is expected to. Check that REBASE_LIVE_SCHEMA_PATH points at the schema source (backend/schema)."
        );
    }

    const scratch = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "rebase-remote-schema-")));
    try {
        for (const repoPath of listed) {
            const contents = await repository.readFile(repoPath);
            if (contents === undefined) continue;
            const local = scratchPathFor(scratch, root, repoPath);
            await fs.mkdir(path.dirname(local), { recursive: true });
            await fs.writeFile(local, contents, "utf8");
        }
        const edit = await options.preview(scratch);
        const files: SchemaChangeFile[] = edit.files.map(file => {
            const relative = path.relative(scratch, file.path);
            if (relative.startsWith("..") || path.isAbsolute(relative)) {
                throw new Error(`The edit wrote ${file.path}, outside the schema directory.`);
            }
            const repoPath = `${root}/${relative.split(path.sep).join("/")}`;
            return file.deleted ? { path: repoPath, contents: "", deleted: true } : { path: repoPath, contents: file.contents };
        });
        return { files: files.sort((a, b) => a.path.localeCompare(b.path)), result: edit.result };
    } finally {
        await fs.rm(scratch, { recursive: true, force: true });
    }
}
