/**
 * CLI command: rebase eject
 *
 * The supported route from the managed runtime to a custom one.
 *
 * Without it, `runtime: "custom"` is a mode a user can only reach by
 * hand-writing an entrypoint they have never seen. The template used to solve
 * that by scaffolding `backend/src/index.ts` into every project — ~190 lines
 * configuring CORS, auth, cookies, storage and history, which the managed
 * runtime never loads. It was the most important-looking file in a new project
 * and editing it did nothing.
 *
 * So the file moved here. A managed project does not carry it; a project that
 * asks for it gets it together with the Dockerfile and the manifest change that
 * make it actually run.
 *
 * There is deliberately no `rebase uneject`. Going back is deleting two files
 * and editing one line, and a command that silently discarded a user's server
 * code would be worse than its absence.
 */
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { RebaseBackendAppConfig } from "@rebasepro/types";
import { requireProjectRoot } from "../utils/project";
import { findBackendApp, loadManifest, ManifestError, resolveBackendPaths, writeManifest } from "../manifest";
import { parseCommandArgs, wantsHelp } from "../utils/args";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Walk up to the package root, which holds `templates/`. */
function findCliRoot(from: string): string | null {
    const root = path.parse(from).root;
    let dir = from;
    while (dir && dir !== root) {
        if (fs.existsSync(path.join(dir, "templates", "eject"))) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

/**
 * The two ways one project's payload differs from another's.
 *
 * Neither is a flag: both were decided at `rebase init` time. `--headless`
 * deletes `config/collections`, `backend/src/schema.generated.ts` and
 * `frontend/`, so a payload that assumes them emits an entrypoint importing
 * three files that are not there and a Dockerfile whose first `COPY` fails.
 */
interface ProjectShape {
    /**
     * Collections declared in code, under `<config>/collections`. Without them
     * the server derives its API from the live database instead — the same
     * signal `rebase build` reads.
     */
    collections: boolean;
    /** A `frontend` workspace for the image to build and the entrypoint to serve. */
    frontend: boolean;
}

/** The block names the payload may switch on. A typo has to be an error. */
const SHAPE_FLAGS = ["collections", "frontend"] as const;

/**
 * Render one payload file for this project.
 *
 * The payload is one set of files rather than one per flavour, because the
 * flavours differ by about a dozen lines and two copies of a 230-line
 * entrypoint are how copies drift — the payload had already drifted from
 * `app/backend/src/index.ts` over `cronsDir`, which silently stopped every cron
 * job in an ejected project. So both branches live in the file, marked with
 * lines that are comments in TypeScript, YAML and Dockerfiles alike:
 *
 *     // {{#collections}}
 *     import { tables } from "./schema.generated.js";
 *     // {{/collections}}
 *     // {{^collections}}
 *     // No schema module: this project introspects the database.
 *     // {{/collections}}
 *
 * `{{#name}}` keeps its block when the flag is on, `{{^name}}` when it is off,
 * and the marker lines themselves never reach the user. The template stays
 * valid TypeScript with every marker line removed, which is the flavour a
 * typechecker would see.
 */
export function renderPayload(contents: string, shape: ProjectShape, projectName: string): string {
    const flags = shape as unknown as Record<string, boolean>;
    const out: string[] = [];
    let open: { name: string; keep: boolean } | null = null;

    for (const line of contents.split("\n")) {
        const marker = /^\s*(?:\/\/|#)\s*\{\{([#^/])([A-Za-z]+)\}\}\s*$/.exec(line);
        if (!marker) {
            if (!open || open.keep) out.push(line);
            continue;
        }
        const [, kind, name] = marker;
        if (kind === "/") {
            if (!open || open.name !== name) {
                throw new Error(`Eject template: {{/${name}}} does not close an open block.`);
            }
            open = null;
            continue;
        }
        if (open) throw new Error(`Eject template: {{${kind}${name}}} inside an open ${open.name} block.`);
        if (!(SHAPE_FLAGS as readonly string[]).includes(name)) {
            throw new Error(`Eject template: unknown block {{${kind}${name}}}.`);
        }
        open = { name,
keep: kind === "#" ? flags[name] === true : flags[name] !== true };
    }

    if (open) throw new Error(`Eject template: {{#${open.name}}} was never closed.`);
    return out.join("\n").replace(/\{\{PROJECT_NAME\}\}/g, projectName);
}

/** Files the eject payload contributes, as `<source> → <destination>`. */
const PAYLOAD: { from: string; to: string; overwrite: boolean }[] = [
    // The entrypoint IS the point of ejecting, so it replaces whatever is
    // there — but only with `--force`, and only after keeping the old file as
    // `.bak`. `runtime: "custom"` (the guard below) means "already ejected",
    // not "nobody wrote a server here": a managed project can have a
    // hand-written `backend/src/index.ts` that `rebase dev` has been running.
    { from: "backend/src/index.ts",
to: "backend/src/index.ts",
overwrite: true },
    { from: "backend/src/env.ts",
to: "backend/src/env.ts",
overwrite: true },
    // The declarations the emitted server imports. Never overwritten — a
    // project that already declares its resources owns that file, and replacing
    // it would silently drop every bucket and database it named. Written when
    // absent because the entrypoint imports it unconditionally: an ejected
    // server that cannot resolve its own resources does not start.
    { from: "config/resources.ts",
to: "config/resources.ts",
overwrite: false },
    // Never overwritten: a Dockerfile someone already wrote is theirs, and so is
    // a compose file they have edited. The scaffolded `docker-compose.yml` is
    // deliberately left alone — it runs the managed shape, and going back should
    // stay a one-line change rather than a restore from git.
    { from: "Dockerfile",
to: "Dockerfile",
overwrite: false },
    { from: "docker-compose.custom.yml",
to: "docker-compose.custom.yml",
overwrite: false }
];

/**
 * The project's name, for the `{{PROJECT_NAME}}` the payload carries.
 *
 * Falls back to the directory name — a compose project name is cosmetic, and a
 * missing or unreadable package.json is not a reason to refuse to eject.
 */
function projectNameOf(projectRoot: string): string {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
        if (typeof pkg.name === "string" && pkg.name.trim()) return pkg.name.trim();
    } catch {
        // fall through
    }
    return path.basename(projectRoot);
}

function printHelp(): void {
    console.log(`
${chalk.bold("rebase eject")} — take ownership of the server process

Writes the backend entrypoint and a Dockerfile into this project, and flips its
backend to ${chalk.cyan('runtime: "custom"')}. From then on this repository builds its own
image: platform runtime upgrades no longer reach it, and CORS, auth wiring,
storage and shutdown become yours to configure.

${chalk.bold("Usage")}
  rebase eject [app]           Take ownership of the server process

${chalk.bold("Options")}
  --dry-run                    List what would change, and change nothing
  --force                      Replace an existing backend/src/index.ts or
                               env.ts, keeping the current file as <name>.bak
  -h, --help                   Show this help
`.trim());
}

export async function ejectCommand(rawArgs: string[] = []): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printHelp();
        return;
    }

    const { flags: args, positionals } = parseCommandArgs({
        spec: {
            "--dry-run": Boolean,
            "--force": Boolean
        },
        rawArgs,
        commandWords: 1,
        command: "eject",
        maxPositionals: 1
    });

    const projectRoot = requireProjectRoot();
    const dryRun = Boolean(args["--dry-run"]);
    const force = Boolean(args["--force"]);
    // Strict parsing rejects an undeclared flag rather than filing it under the
    // positionals, so the first one is the app — there is nothing to filter out.
    const requested = positionals[0];

    // A tombstone, not a shim. `rebase eject infra` wrote `rebase.infra.json`,
    // which described itself as "read BEFORE the environment" and was read by
    // nothing at all — `loadInfraConfig` and `bindResources` had no caller
    // outside their own tests, while the CHANGELOG and the docs advertised the
    // file as a supported escape hatch.
    //
    // Named rather than left to fall through, because without this the word
    // `infra` lands in the app lookup and the error becomes "unknown app:
    // infra" — which sends someone looking for a bug in their manifest.
    if (requested === "infra") {
        console.error(chalk.red("  ✗ `rebase eject infra` has been removed."));
        console.error(chalk.gray("    It wrote rebase.infra.json, which nothing ever read. Resources bind"));
        console.error(chalk.gray("    from the environment on the <BASE>__<KEY> convention; declare them in"));
        console.error(chalk.gray("    config/resources.ts and see `rebase resources` for the names."));
        process.exit(1);
    }

    let loaded;
    try {
        loaded = loadManifest(projectRoot);
    } catch (err) {
        if (err instanceof ManifestError) {
            console.error(chalk.red(`✗ ${err.message}`));
            for (const issue of err.issues) {
                console.error(chalk.dim(`    ${issue.path}: ${issue.message}`));
            }
            process.exit(1);
        }
        throw err;
    }

    const { manifest } = loaded;

    let appName: string;
    let app: RebaseBackendAppConfig;

    if (requested) {
        const declared = manifest.apps[requested];
        if (!declared) {
            console.error(chalk.red(`✗ No app named "${requested}" in rebase.json.`));
            console.error(chalk.dim(`  Declared: ${Object.keys(manifest.apps).join(", ") || "(none)"}`));
            process.exit(1);
        }
        if (declared.type !== "backend") {
            // Ejecting is about who runs the server. A static app has no server.
            console.error(chalk.red(`✗ "${requested}" is a ${declared.type} app — only a backend can be ejected.`));
            process.exit(1);
        }
        appName = requested;
        app = declared;
    } else {
        const backend = findBackendApp(manifest);
        if (!backend) {
            console.error(chalk.red("✗ This repository declares no backend app."));
            console.error(chalk.dim("  Only the repository that declares the backend chooses its runtime."));
            process.exit(1);
        }
        appName = backend.name;
        app = backend.app;
    }

    if (app.runtime === "custom") {
        console.error(chalk.red(`✗ "${appName}" is already ejected — it declares runtime: "custom".`));
        console.error(chalk.dim(`  Its entrypoint is ${app.dockerfile ?? "Dockerfile"} and backend/src/index.ts.`));
        process.exit(1);
    }

    const cliRoot = findCliRoot(__dirname);
    if (!cliRoot) {
        console.error(chalk.red("✗ Could not locate the eject templates. Reinstall @rebasepro/cli."));
        process.exit(1);
    }
    const payloadDir = path.join(cliRoot!, "templates", "eject");

    // What the payload has to look like here. Read from the project rather than
    // asked for: `--headless` left no collections and no frontend, and an
    // entrypoint importing either would not compile.
    const paths = resolveBackendPaths(app, projectRoot);
    const shape: ProjectShape = {
        collections: paths.hasCollections,
        frontend: fs.existsSync(path.join(projectRoot, "frontend"))
    };

    // Decide everything before writing anything, so --dry-run and the real run
    // report the same list and a mid-way failure cannot leave a half-ejected
    // project.
    const planned: { to: string; action: "write" | "keep" | "overwrite" }[] = [];
    const blocked: string[] = [];
    for (const file of PAYLOAD) {
        const source = path.join(payloadDir, file.from);
        if (!fs.existsSync(source)) {
            console.error(chalk.red(`✗ The eject template is missing ${file.from}. Reinstall @rebasepro/cli.`));
            process.exit(1);
        }
        const exists = fs.existsSync(path.join(projectRoot, file.to));
        if (exists && file.overwrite && !force) blocked.push(file.to);
        planned.push({
            to: file.to,
            action: !exists ? "write" : file.overwrite ? "overwrite" : "keep"
        });
    }

    if (blocked.length > 0) {
        // A managed backend never loads `backend/src/index.ts`, but `rebase dev`
        // does — it picks the entrypoint by file existence — so this file is very
        // often a server someone is running and editing. Replacing it without
        // being asked is the one unrecoverable thing this command could do.
        console.error(chalk.red("✗ Ejecting would replace a file this project already has:"));
        for (const item of blocked) console.error(chalk.red(`      ${item}`));
        console.error(chalk.dim("  Eject writes its own entrypoint — it does not adopt yours."));
        console.error(chalk.dim("  Move the file aside, or re-run with --force, which keeps the current"));
        console.error(chalk.dim("  contents as <name>.bak."));
        process.exit(1);
    }

    if (dryRun) {
        console.log(chalk.bold(`Would eject "${appName}" to a custom runtime:`));
        console.log("");
        for (const item of planned) {
            if (item.action === "write") console.log(`  ${chalk.green("write")}      ${item.to}`);
            else if (item.action === "overwrite") {
                console.log(`  ${chalk.yellow("overwrite")}  ${item.to} ${chalk.dim(`(kept as ${item.to}.bak)`)}`);
            } else console.log(`  ${chalk.dim("keep")}       ${item.to} ${chalk.dim("(already exists)")}`);
        }
        console.log(`  ${chalk.green("write")}      rebase.json ${chalk.dim('(runtime: "custom")')}`);
        // Not part of the payload table, but it is changed on the real run, and
        // a dry run's whole purpose is to enumerate what changes.
        if (fs.existsSync(path.join(projectRoot, "backend", "package.json"))) {
            console.log(`  ${chalk.green("write")}      backend/package.json ${chalk.dim("(main, dev and start scripts)")}`);
        }
        console.log("");
        console.log(chalk.dim("Nothing was changed."));
        return;
    }

    const projectName = projectNameOf(projectRoot);
    const backups: string[] = [];
    for (const [index, file] of PAYLOAD.entries()) {
        if (planned[index].action === "keep") continue;
        const destination = path.join(projectRoot, file.to);
        if (planned[index].action === "overwrite") {
            fs.copyFileSync(destination, `${destination}.bak`);
            backups.push(`${file.to}.bak`);
        }
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        const contents = renderPayload(
            fs.readFileSync(path.join(payloadDir, file.from), "utf8"),
            shape,
            projectName
        );
        fs.writeFileSync(destination, contents, "utf8");
    }

    const dockerfile = app.dockerfile ?? "Dockerfile";
    manifest.apps[appName] = {
        ...app,
        runtime: "custom",
        dockerfile,
        port: app.port ?? 8080
    };
    writeManifest(projectRoot, manifest);

    // The backend workspace stops being a package the runtime reads and becomes
    // one that is run. Its scripts have to say so, or `npm start` in the image
    // has nothing to call.
    restoreBackendScripts(projectRoot);

    console.log("");
    console.log(chalk.green(`✓ Ejected "${appName}" to a custom runtime.`));
    console.log("");
    console.log(`  ${chalk.cyan("backend/src/index.ts".padEnd(26))} your entrypoint — the runtime no longer boots the bundle`);
    console.log(`  ${chalk.cyan("backend/src/env.ts".padEnd(26))} the environment it reads`);
    console.log(`  ${chalk.cyan(dockerfile.padEnd(26))} your image`);
    console.log(`  ${chalk.cyan("docker-compose.custom.yml".padEnd(26))} runs it`);
    console.log(`  ${chalk.cyan("rebase.json".padEnd(26))} runtime: custom`);
    for (const backup of backups) {
        console.log(`  ${chalk.cyan(backup.padEnd(26))} what was there before`);
    }
    console.log("");
    console.log(chalk.yellow("  You now own CORS, auth wiring, storage and shutdown. Platform runtime"));
    console.log(chalk.yellow("  upgrades no longer reach this project."));
    if (!shape.collections) {
        console.log(chalk.yellow("  This project declares no collections, so the entrypoint derives them"));
        console.log(chalk.yellow("  from the live database, as the managed runtime did."));
    }
    console.log("");
    console.log(chalk.dim(`  ${chalk.cyan("docker compose -f docker-compose.custom.yml up --build")}`));
    console.log(chalk.dim("  docker-compose.yml is untouched — it still runs the managed shape if you go back."));
    console.log("");
}

/**
 * Point the backend workspace's scripts at the entrypoint that now exists.
 *
 * A managed project's backend package deliberately declares no `main` and no
 * `start`: there is no entrypoint to name. Ejecting creates one.
 */
function restoreBackendScripts(projectRoot: string): void {
    const packagePath = path.join(projectRoot, "backend", "package.json");
    if (!fs.existsSync(packagePath)) return;

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    } catch {
        // A malformed package.json is the user's to fix, and refusing to finish
        // the eject over it would leave the project half-changed.
        console.log(chalk.yellow("  ⚠ backend/package.json is not valid JSON — its scripts were left alone."));
        return;
    }

    const scripts = (parsed.scripts ?? {}) as Record<string, string>;
    parsed.main ??= "src/index.ts";
    scripts.dev ??= 'tsx watch --include="../config/**/*" --include="./functions/**/*" src/index.ts';
    scripts.start ??= "node dist/backend/src/index.js";
    parsed.scripts = scripts;

    fs.writeFileSync(packagePath, `${JSON.stringify(parsed, null, 4)}\n`, "utf8");
}
