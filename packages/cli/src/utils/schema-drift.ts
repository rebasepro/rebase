/**
 * Which edits under the tables directory can put the *SQL* schema out of date.
 *
 * `rebase dev` watches `backend/schema` and, on a change, either tells the
 * developer to run `rebase schema generate` / `rebase db push` or runs them.
 *
 * Every source file there is a schema edit. The directory holds `defineTable`
 * and `defineView` declarations and the helpers they import, and nothing else:
 * presentation (`customizeTable`) lives in `frontend/src/cms`, and Firestore
 * collections (`defineFirestoreCollection`) are client-side and live there too.
 * The old layout had to tell a Postgres collection from a Firestore one, and an
 * admin-only edit from a SQL one, by reading the file; this one does not.
 *
 * Unlike the old collections directory, the loader does not scan files: it
 * imports `index.ts`, which imports the rest — so `index.ts` itself counts, and
 * so does a file in a subdirectory.
 *
 * What does not count is what no import of the schema can reach: tests,
 * declaration files, dotfiles (editor swap and lock files), and anything that is
 * not a module.
 */
import path from "path";

const MODULE_EXTENSIONS = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs"];

/**
 * Can an edit to this file have changed the generated SQL schema?
 *
 * `relativePath` is relative to the tables directory, as `fs.watch` reports it.
 */
export function isSchemaSourceFile(relativePath: string): boolean {
    const segments = relativePath.split(path.sep).join("/").split("/");
    if (segments.some(segment => segment.startsWith("."))) return false;
    const file = segments[segments.length - 1];
    if (!MODULE_EXTENSIONS.some(extension => file.endsWith(extension))) return false;
    if (/\.d\.[cm]?ts$/.test(file)) return false;
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) return false;
    return true;
}
