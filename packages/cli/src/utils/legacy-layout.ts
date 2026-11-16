/**
 * A project still on the `config/collections` layout, found before anything is
 * built or uploaded.
 *
 * 0.31 moved the schema to `backend/schema` (bundle format 3, runtime contract
 * 2), and both the runtime and Rebase Cloud refuse a bundle built the old way.
 * What they cannot do is refuse it EARLY: the platform sees the manifest only
 * when the deploy is triggered, after the whole bundle has been uploaded. And a
 * project in that state did not reach a useful message on this side either:
 * `rebase build` failed on whatever check came first (SongBuzz, 2026-11-16, was
 * told its admin's Vite config lacked `rebaseBackendGuard()`), because nothing
 * here looks for a layout this CLI no longer reads.
 *
 * Old `rebase.json` fields (`config`, `usersCollection`) are refused by
 * `loadManifest`. This is the case it cannot see: a manifest written after those
 * fields were retired, on a project whose tables are still in
 * `config/collections` — every project scaffolded from 0.25 to 0.30.
 */
import fs from "fs";
import path from "path";
import { findTablesIndex } from "../manifest";

/** Where the retired layout kept its collections, relative to the project root. */
export const LEGACY_COLLECTIONS_DIR = "config/collections";

/** The command that moves a project off it, exactly as a person types it. */
export const MIGRATE_COMMAND = "rebase migrate collections-to-tables";

/**
 * `config/collections` when the project declares its tables there and has no
 * tables directory to replace them; `undefined` otherwise.
 *
 * A project mid-migration has both, and is not legacy: the codemod leaves
 * `config/collections` in place for `--check` until its author deletes it.
 *
 * @param tablesDir The backend's tables directory, relative to the root.
 */
export function legacyCollectionsDir(projectRoot: string, tablesDir: string): string | undefined {
    const legacy = path.join(projectRoot, LEGACY_COLLECTIONS_DIR);
    if (findTablesIndex(path.join(projectRoot, tablesDir)) !== undefined) return undefined;
    if (findTablesIndex(legacy) === undefined) return undefined;
    return LEGACY_COLLECTIONS_DIR;
}

/**
 * The refusal, as a message and a hint. The command is in the message, not only
 * the hint, so a caller that prints one line still names it.
 */
export function legacyLayoutRefusal(legacyDir: string, tablesDir: string): { message: string; hint: string } {
    return {
        message:
            `This project declares its tables in ${legacyDir}, which Rebase 0.31 and later no longer build ` +
            `or deploy: they read ${tablesDir}. Run \`${MIGRATE_COMMAND}\` to move them.`,
        hint:
            `\`${MIGRATE_COMMAND} --dry-run\` shows every file it would write. Run it without --dry-run ` +
            `(it checks that the generated SQL is unchanged), commit the result, then build and deploy again.`
    };
}
