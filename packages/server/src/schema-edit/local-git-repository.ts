/**
 * A {@link SchemaEditRepository} backed by the working tree the server is
 * running in.
 *
 * This is the implementation for the two deployment shapes that have their
 * source on disk — `rebase dev` on a developer's machine, and a self-host with
 * the project mounted. Both have a `.git` next to the collections, so a commit
 * is a local `git commit`: nothing to authenticate, nothing to fetch, no token.
 *
 * The remote implementation, for a Cloud tenant whose repository lives on
 * GitHub, satisfies the same interface and is a separate file. Neither knows
 * about the other.
 *
 * ## Why it stages paths explicitly
 *
 * Never `git add -A`. A schema change runs while somebody may have unrelated
 * work in the tree, and sweeping that into a commit nobody wrote is worse than
 * refusing — it is a commit that cannot be reviewed because nobody knows what
 * is in it. `applySchemaChange` refuses up front when the tree already has
 * *our* files modified; this stages the exact list and nothing else.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SchemaEditRepository } from "./apply-schema-change";
import type { SchemaChangeFile } from "@rebasepro/types";

const run = promisify(execFile);

export interface LocalGitOptions {
    /** Absolute path to the working tree the collections live in. */
    root: string;
    /**
     * Who the commit is attributed to. Defaults to the repository's own git
     * config, which is right for a developer's machine and wrong for a server
     * — a panel edit should say which account made it.
     */
    author?: { name: string; email: string };
}

export class GitCommandError extends Error {
    constructor(command: string, detail: string) {
        super(`git ${command} failed: ${detail}`);
        this.name = "GitCommandError";
    }
}

/**
 * `--` before paths, always: a file called `main` would otherwise be read as a
 * revision, and the failure mode is a command that does something else entirely.
 */
async function git(root: string, args: string[]): Promise<string> {
    try {
        // `core.fsmonitor=false`: a stale fsmonitor daemon reports a clean tree
        // that is not, which for this module means committing nothing and
        // reporting success.
        const { stdout } = await run("git", ["-c", "core.fsmonitor=false", ...args], {
            cwd: root,
            maxBuffer: 32 * 1024 * 1024
        });
        return stdout;
    } catch (err) {
        throw new GitCommandError(subcommandOf(args), failureDetail(err));
    }
}

/**
 * The git subcommand in an argument list, past any `-c key=value` pairs.
 *
 * `args[0]` named the first *argument*, and a commit with an author starts
 * with `-c user.name=…` — so a refused commit was reported as "git -c failed",
 * which names nothing anybody can act on.
 */
function subcommandOf(args: string[]): string {
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "-c") { i++; continue; }
        if (!args[i].startsWith("-")) return args[i];
    }
    return args[0] ?? "";
}

/**
 * What git (or a hook it ran) said, rather than the command line it ran.
 *
 * A pre-commit hook writes its refusal wherever it likes — lint-staged and
 * husky print to stdout as often as to stderr — and that text is the only
 * useful part of the failure.
 */
function failureDetail(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const { stderr, stdout } = err as { stderr?: string; stdout?: string };
    const said = [stderr?.trim(), stdout?.trim()].filter(Boolean).join("\n");
    return said || err.message;
}

/**
 * The top of the working tree containing `startDir`, or undefined.
 *
 * Resolved by asking git rather than by walking for a `.git`, because a
 * worktree's `.git` is a file and a submodule's is neither where nor what a
 * naive walk expects.
 */
export async function findRepositoryRoot(startDir: string): Promise<string | undefined> {
    try {
        const out = await git(startDir, ["rev-parse", "--show-toplevel"]);
        const root = out.trim();
        return root.length > 0 ? root : undefined;
    } catch {
        return undefined;
    }
}

/** True when `root` is inside a git working tree. */
export async function isGitRepository(root: string): Promise<boolean> {
    try {
        const out = await git(root, ["rev-parse", "--is-inside-work-tree"]);
        return out.trim() === "true";
    } catch {
        return false;
    }
}

export function createLocalGitRepository(options: LocalGitOptions): SchemaEditRepository {
    const { root } = options;

    /**
     * An absolute path for a repository-relative one, refusing one outside the
     * tree. The paths come from the generator rather than from a request, but
     * a path that escapes the repository is worth failing on rather than
     * trusting the layer above to have checked.
     */
    const inside = (relative: string): string => {
        const absolute = path.resolve(root, relative);
        if (!absolute.startsWith(path.resolve(root) + path.sep)) {
            throw new Error(`Refusing to write outside the repository: ${relative}`);
        }
        return absolute;
    };

    return {
        root,

        async currentBranch(): Promise<string> {
            const branch = (await git(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
            // A detached HEAD has no branch to commit onto in any meaningful
            // sense; saying so beats reporting "HEAD" as though it were one.
            if (branch === "HEAD") {
                throw new GitCommandError(
                    "rev-parse",
                    "the working tree is on a detached HEAD, so there is no branch to commit to. " +
                    "Check out a branch first."
                );
            }
            return branch;
        },

        async dirtyPaths(): Promise<string[]> {
            // `-z` and NUL splitting: a path with a space or a quote is
            // otherwise rendered quoted and would not match what we staged.
            const out = await git(root, ["status", "--porcelain=v1", "-z"]);
            const paths: string[] = [];
            for (const entry of out.split("\0")) {
                if (!entry) continue;
                // "XY path" — two status characters, a space, then the path.
                const file = entry.slice(3);
                if (file) paths.push(file);
            }
            return paths;
        },

        async writeFiles(files: SchemaChangeFile[]): Promise<void> {
            for (const file of files) {
                const absolute = inside(file.path);
                await fs.mkdir(path.dirname(absolute), { recursive: true });
                await fs.writeFile(absolute, file.contents, "utf8");
            }
        },

        async readFile(filePath: string): Promise<string | undefined> {
            try {
                return await fs.readFile(inside(filePath), "utf8");
            } catch (err) {
                if ((err as { code?: string }).code === "ENOENT") return undefined;
                throw err;
            }
        },

        async restore(files: { path: string; contents: string | undefined }[]): Promise<void> {
            for (const file of files) {
                const absolute = inside(file.path);
                if (file.contents === undefined) {
                    await fs.rm(absolute, { force: true });
                } else {
                    await fs.mkdir(path.dirname(absolute), { recursive: true });
                    await fs.writeFile(absolute, file.contents, "utf8");
                }
            }
            if (files.length === 0) return;
            // Unstage what the refused commit staged. Per path, because a path
            // that never existed and was never added is unknown to git, and
            // one such path would fail the whole `reset`.
            for (const file of files) {
                await git(root, ["reset", "-q", "--", file.path]).catch(() => undefined);
            }
        },

        async commit(paths: string[], message: string): Promise<string> {
            if (paths.length === 0) throw new Error("Refusing to commit an empty path list.");

            await git(root, ["add", "--", ...paths]);

            // Nothing staged means the generated files were byte-identical to
            // what was already there. That is a real outcome — regenerating an
            // unchanged schema — and not an error, so report the current head.
            const staged = await git(root, ["diff", "--cached", "--name-only", "--", ...paths]);
            if (staged.trim() === "") {
                return (await git(root, ["rev-parse", "HEAD"])).trim();
            }

            const identity = options.author
                ? [
                    "-c", `user.name=${options.author.name}`,
                    "-c", `user.email=${options.author.email}`
                ]
                : [];

            await git(root, [
                ...identity,
                "commit",
                // Only what we staged, even if the tree has other staged work.
                "--only",
                "-m", message,
                "--", ...paths
            ]);

            return (await git(root, ["rev-parse", "HEAD"])).trim();
        }
    };
}
