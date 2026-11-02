/**
 * The note a Rebase project leaves at the root of the repository it sits in.
 *
 * A project's `CLAUDE.md`, `AGENTS.md` and the rest are loaded by an assistant
 * started in the project's own directory. One started at the root of a larger
 * repository — `my-app/` holding the site, with the Rebase project in
 * `my-app/cloud/` — loads none of them, and opens none of the files they point
 * to unless something sends it there. That is how an agent building a game on
 * Rebase came to make twelve tables with `CREATE TABLE` in a function: every
 * rule against it was in `cloud/`, and the agent never went there.
 *
 * So `rebase init` and `rebase skills install` write a marked block into the
 * repository root's `CLAUDE.md` and `AGENTS.md`: where the project is, and the
 * scaffold's "Before you write any code" rules, read from the template so there
 * is one copy to keep true. A file that is not there is created; one that is
 * gets the block appended, or replaced between its markers on a later run.
 * `REBASE_ROOT_RULES=0` turns it off, for a root whose agent files are kept by
 * hand — and for this package's tests, which scaffold inside this repository.
 */
import fs from "fs";
import path from "path";

export const ROOT_POINTER_START = "<!-- rebase:project -->";
export const ROOT_POINTER_END = "<!-- /rebase:project -->";
export const ROOT_POINTER_FILES = ["CLAUDE.md", "AGENTS.md"] as const;

const RULES_HEADING = "## Before you write any code";

/**
 * The repository root above a project, or null when the project is the root
 * itself or is in no repository. The project's own directory is not a candidate:
 * there its own files already load.
 */
export function enclosingRepositoryRoot(projectDir: string): string | null {
    let dir = path.dirname(path.resolve(projectDir));
    const top = path.parse(dir).root;
    while (true) {
        if (fs.existsSync(path.join(dir, ".git"))) return dir;
        if (dir === top) return null;
        dir = path.dirname(dir);
    }
}

/** The rules block from the scaffold's `CLAUDE.md`, heading included. */
export function scaffoldRules(templateDir: string): string {
    const text = fs.readFileSync(path.join(templateDir, "CLAUDE.md"), "utf8");
    const at = text.indexOf(RULES_HEADING);
    if (at === -1) throw new Error(`${path.join(templateDir, "CLAUDE.md")} has no "${RULES_HEADING}" block`);
    return text.slice(at).trim();
}

/** The marked block for a project at `relativeDir` from the repository root. */
export function rootPointerBlock(relativeDir: string, rules: string): string {
    const dir = relativeDir.split(path.sep).join("/");
    return [
        ROOT_POINTER_START,
        "## Rebase project",
        "",
        `\`${dir}/\` is a Rebase project. Before you change anything in it, read \`${dir}/ai-instructions.md\`; the rules below hold even before you do. Their paths are relative to \`${dir}/\`.`,
        "",
        rules.replace(RULES_HEADING, `### Before you write any code in \`${dir}/\``),
        ROOT_POINTER_END
    ].join("\n");
}

/** `text` with the block in it: replaced between its markers, or appended. */
export function withRootPointer(text: string, block: string): string {
    const start = text.indexOf(ROOT_POINTER_START);
    const end = text.indexOf(ROOT_POINTER_END);
    if (start !== -1 && end > start) {
        return text.slice(0, start) + block + text.slice(end + ROOT_POINTER_END.length);
    }
    if (text.trim() === "") return block + "\n";
    return text.replace(/\s*$/, "\n\n") + block + "\n";
}

/**
 * Write the block into the repository root's agent files when the project is
 * below that root. Returns the files that changed, as absolute paths.
 */
export function writeRootPointers(projectDir: string, templateDir: string): string[] {
    if (process.env.REBASE_ROOT_RULES === "0") return [];
    const root = enclosingRepositoryRoot(projectDir);
    if (!root) return [];
    const block = rootPointerBlock(path.relative(root, path.resolve(projectDir)), scaffoldRules(templateDir));
    const changed: string[] = [];
    for (const name of ROOT_POINTER_FILES) {
        const file = path.join(root, name);
        const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const after = withRootPointer(before, block);
        if (after === before) continue;
        fs.writeFileSync(file, after);
        changed.push(file);
    }
    return changed;
}
