/**
 * "Install this optional dependency", spelled so it works where the reader
 * types it: from the project root, in the project's own package manager.
 *
 * A scaffolded project is a workspace whose backend is the member `backend`,
 * and the backend runs there. A bare `pnpm add -D <pkg>` typed at the root —
 * where a reader is, reading `rebase dev`'s output or the admin panel —
 * refuses with `ERR_PNPM_ADDING_TO_ROOT`, so the command names the member.
 *
 * The same rules as the driver's `describeDevAddCommand`
 * (`@rebasepro/server-postgres`, `cli-helpers.ts`), which the CLI prints for
 * atlas. That package depends on this one, not the other way round, so the
 * server keeps its own copy. Host-side: it reads the file system.
 *
 * @module
 */
import fs from "node:fs";
import path from "node:path";

type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

const LOCKFILES: ReadonlyArray<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"]
];

/** Which package manager built the project, read off the nearest lockfile at or above `startDir`. pnpm when none. */
function projectPackageManager(startDir: string): PackageManager {
    for (let dir = path.resolve(startDir); ; dir = path.dirname(dir)) {
        for (const [file, manager] of LOCKFILES) {
            if (fs.existsSync(path.join(dir, file))) return manager;
        }
        if (path.dirname(dir) === dir) return "pnpm";
    }
}

function isWorkspaceRoot(dir: string): boolean {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return true;
    try {
        const manifest: unknown = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        return typeof manifest === "object" && manifest !== null && "workspaces" in manifest;
    } catch {
        return false;
    }
}

/**
 * The workspace member `startDir` is in, relative to the workspace root —
 * `backend` in a scaffold — or null at that root and outside any workspace.
 */
function workspaceMember(startDir: string): string | null {
    let member = path.resolve(startDir);
    while (!fs.existsSync(path.join(member, "package.json"))) {
        const parent = path.dirname(member);
        if (parent === member) return null;
        member = parent;
    }
    for (let dir = path.dirname(member); ; dir = path.dirname(dir)) {
        if (isWorkspaceRoot(dir)) return path.relative(dir, member).split(path.sep).join("/");
        if (path.dirname(dir) === dir) return null;
    }
}

/** A path as one shell word: as it is when it needs no quoting, single-quoted otherwise. */
const shellWord = (value: string): string =>
    /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;

/**
 * `add -D <spec>` for the package the backend in `startDir` runs from, typed
 * at the project root: `pnpm --dir backend add -D ts-morph@28.0.0` in a
 * scaffold, `pnpm add -D ts-morph@28.0.0` where the backend is the project.
 */
export function devDependencyInstallCommand(spec: string, startDir: string = process.cwd()): string {
    const member = workspaceMember(startDir);
    const dir = member === null ? null : shellWord(member);
    switch (projectPackageManager(startDir)) {
        case "npm": return dir ? `npm install -D ${spec} -w ${dir}` : `npm install -D ${spec}`;
        case "yarn": return dir ? `yarn --cwd ${dir} add -D ${spec}` : `yarn add -D ${spec}`;
        case "bun": return dir ? `bun add -d ${spec} --cwd ${dir}` : `bun add -d ${spec}`;
        case "pnpm":
        default: return dir ? `pnpm --dir ${dir} add -D ${spec}` : `pnpm add -D ${spec}`;
    }
}

/** The `ts-morph` the schema editor is built against: the server's optional peer. */
const TS_MORPH = "ts-morph@28.0.0";

/**
 * How to turn on what needs `ts-morph`, as the end of a sentence that has
 * said it is missing: "Run `pnpm --dir backend add -D ts-morph@28.0.0` from
 * the project root, then restart the backend, to enable it."
 *
 * `pnpm`, never `npm`, in a pnpm project: running npm inside one rewrites
 * node_modules into a hoisted layout pnpm then disagrees with (docs/bug-classes.md §5).
 */
export function tsMorphInstallSentence(startDir: string = process.cwd()): string {
    const command = devDependencyInstallCommand(TS_MORPH, startDir);
    const where = workspaceMember(startDir) === null ? "" : " from the project root";
    return `Run \`${command}\`${where}, then restart the backend, to enable it.`;
}
