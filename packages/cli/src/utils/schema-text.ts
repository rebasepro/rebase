/**
 * The tables a schema directory declares, read as text — never imported.
 *
 * For the commands that must not run a project's code to answer a question
 * about its files: `rebase doctor` (two tables claiming one slug) and `rebase
 * generate view --collection` (does that table exist, before writing a view
 * for it). A schema file may import anything the project depends on; reading
 * it is enough to see each `defineTable("name", …)`.
 */
import fs from "fs";
import path from "path";

/** A table one schema file declares. */
export interface DeclaredTable {
    /** The API slug: the definition's name, or its `slug: "…"` override. */
    slug: string;
    /** The file it is declared in, absolute. */
    file: string;
}

/**
 * Every module under the schema directory, depth first and sorted: what the
 * loader would import. Tests, declaration files, dotfiles and `node_modules`
 * are not modules of the schema.
 */
export function schemaModules(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.(ts|js|mts|mjs)$/.test(entry.name) && !/\.(d|test|spec)\./.test(entry.name)) out.push(full);
        }
    };
    walk(dir);
    return out;
}

/**
 * The slug of every table one schema file's source declares.
 *
 * Each `defineTable("name", …)` / `defineAuthTable` / `defineView` call is a
 * table whose slug is its name, unless a `slug: "…"` appears before the next
 * definition. A computed name or slug is simply not seen, which is the right
 * failure for checks that only ever report or refuse.
 */
export function declaredTableSlugs(source: string): string[] {
    const calls = [...source.matchAll(/\bdefine(?:Auth)?(?:Table|View)\s*(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g)];
    return calls.map((call, i) => {
        const end = i + 1 < calls.length ? calls[i + 1].index : source.length;
        const body = source.slice(call.index + call[0].length, end);
        return /\bslug:\s*["'`]([^"'`]+)["'`]/.exec(body)?.[1] ?? call[1];
    });
}

/** Every table the schema directory's files declare, in file order. */
export function declaredTables(schemaDir: string): DeclaredTable[] {
    const tables: DeclaredTable[] = [];
    for (const file of schemaModules(schemaDir)) {
        let source: string;
        try {
            source = fs.readFileSync(file, "utf-8");
        } catch {
            continue;
        }
        for (const slug of declaredTableSlugs(source)) tables.push({ slug, file });
    }
    return tables;
}
