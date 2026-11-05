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
 * `REBASE_ROOT_RULES=0` (any off spelling `parseEnvBoolean` reads) turns it
 * off, for a root whose agent files are kept by hand — and for this package's
 * tests, which scaffold inside this repository.
 *
 * Nothing is written at the home directory or above it: a dotfiles repository
 * at `~` makes `~` the root of every project below it, and an assistant loads
 * `~/CLAUDE.md` in every session it starts under home. Nor where the repository
 * ignores the project, which is then not part of it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { parseEnvBoolean } from "@rebasepro/types";

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
        "<!-- Written by `rebase init` and `rebase skills install`: edits between these markers are overwritten. -->",
        "## Rebase project",
        "",
        `\`${dir}/\` is a Rebase project. Before you change anything in it, read \`${dir}/ai-instructions.md\`; the rules below hold even before you do. Their paths are relative to \`${dir}/\`.`,
        "",
        rules.replace(RULES_HEADING, `### Before you write any code in \`${dir}/\``),
        ROOT_POINTER_END
    ].join("\n");
}

function occurrences(text: string, marker: string): number {
    return text.split(marker).length - 1;
}

/**
 * `text` with the block in it: replaced between its markers, or appended.
 * Null when the markers cannot say where the block is — one of them alone, more
 * than one of either, or the end before the start: replacing from an orphan
 * start to a new end would take whatever the user wrote in between with it.
 * The block takes the file's line ending, so a CRLF file stays CRLF and a
 * second run finds it unchanged.
 */
export function withRootPointer(text: string, block: string): string | null {
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = block.replace(/\r?\n/g, eol);
    const starts = occurrences(text, ROOT_POINTER_START);
    const ends = occurrences(text, ROOT_POINTER_END);
    if (starts === 0 && ends === 0) {
        if (text.trim() === "") return lines + eol;
        return text.replace(/\s*$/, eol + eol) + lines + eol;
    }
    const start = text.indexOf(ROOT_POINTER_START);
    const end = text.indexOf(ROOT_POINTER_END);
    if (starts !== 1 || ends !== 1 || end < start) return null;
    return text.slice(0, start) + lines + text.slice(end + ROOT_POINTER_END.length);
}

/**
 * Why the block may not go into `root`, or null when it may: `root` is the home
 * directory or above it, or the repository ignores the project.
 */
export function rootPointerRefusal(root: string, projectDir: string): string | null {
    const home = path.resolve(os.homedir());
    const fromRoot = path.relative(root, home);
    if (fromRoot === "" || (!fromRoot.startsWith("..") && !path.isAbsolute(fromRoot))) {
        return `${root} is the home directory or above it, and its agent files load in every session there`;
    }
    // Exit 0: ignored. 1: not ignored. Anything else (no git, not a real
    // repository) says nothing about the project, and the block is written.
    const relative = path.relative(root, path.resolve(projectDir));
    const ignored = spawnSync("git", ["-C", root, "check-ignore", "-q", "--", relative], { stdio: "ignore" });
    if (ignored.status === 0) return `${root} ignores ${relative}/, so the project is not part of that repository`;
    return null;
}

export interface RootPointerResult {
    /** The files that changed, as absolute paths. */
    changed: string[];
    /** Files left as they were, each with the reason, for the user to fix by hand. */
    untouched: { file: string; reason: string }[];
    /** Why the repository root above the project got nothing, when it was refused. */
    refused: string | null;
}

/**
 * Write the block into the repository root's agent files when the project is
 * below that root.
 */
export function writeRootPointers(projectDir: string, templateDir: string): RootPointerResult {
    const result: RootPointerResult = { changed: [], untouched: [], refused: null };
    if (parseEnvBoolean(process.env.REBASE_ROOT_RULES) === false) return result;
    const root = enclosingRepositoryRoot(projectDir);
    if (!root) return result;
    result.refused = rootPointerRefusal(root, projectDir);
    if (result.refused !== null) return result;
    const block = rootPointerBlock(path.relative(root, path.resolve(projectDir)), scaffoldRules(templateDir));
    for (const name of ROOT_POINTER_FILES) {
        const file = path.join(root, name);
        const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
        const after = withRootPointer(before, block);
        if (after === null) {
            result.untouched.push({
                file,
                reason: `its ${ROOT_POINTER_START} and ${ROOT_POINTER_END} markers are not one start followed by one end`
            });
            continue;
        }
        if (after === before) continue;
        fs.writeFileSync(file, after);
        result.changed.push(file);
    }
    return result;
}
