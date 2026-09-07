import path from "path";
import fs from "fs";

import chalk from "chalk";

import { normalizeEsmSpecifiers } from "../bundle";
import { parseCommandArgs } from "../utils/args";

/**
 * Give compiled output the relative-import extensions Node's ESM loader needs.
 *
 * ## Why a project needs this at all
 *
 * TypeScript does not rewrite module specifiers, deliberately and by long-stated
 * policy: what you write is what it emits. Node's ESM loader, equally
 * deliberately, resolves no extensions — `./authors` is not a module, only
 * `./authors.js` is. Between those two positions sits every project that writes
 * extensionless relative imports, which is most of them, and which
 * `moduleResolution: "bundler"` — what this scaffold ships — is designed for.
 *
 * The usual escape is to write the *output* extension in the *source*:
 * `import x from "./authors.js"` in a file called `authors.ts`. It works, and it
 * is a tax on every import in the project to satisfy a step the toolchain could
 * take itself. This is that step.
 *
 * ## Why it is a command
 *
 * `rebase build` has always done this to its own bundle — the specifiers in
 * `dist-bundle` are complete because {@link normalizeEsmSpecifiers} completes
 * them. Nothing did it for the plain `tsc` output that `rebase eject` runs
 * (`node dist/backend/src/index.js`) or that a self-hoster runs after
 * `pnpm build`. So the templates wrote `.js` in source, which is the tax, and
 * removing it silently broke eject at `pnpm start` while `check:eject` — which
 * typechecks with `noEmit` — stayed green.
 *
 * One implementation, on both paths, callable from a package.json script.
 *
 * Mechanical and verifiable: only relative specifiers are touched, and only when
 * the target resolves to a file that exists. Idempotent, so a build that runs it
 * twice is a build that runs it once.
 */
export const NORMALIZE_IMPORTS_FLAGS = {
    /** Report what would change without writing anything. */
    "--check": Boolean
} as const;

const HELP = `
${chalk.bold("rebase normalize-imports")} — complete the relative imports in compiled output

${chalk.green.bold("Usage")}
  rebase normalize-imports ${chalk.blue("<dir>")} [--check]

${chalk.green.bold("What it does")}
  TypeScript emits your module specifiers verbatim, and Node's ESM loader does
  not guess extensions — so \`./authors\` compiles fine and fails at run time.
  This rewrites each relative specifier in the emitted JavaScript to the file it
  actually resolves to, so your source can stay extensionless.

  Only relative specifiers, only when the target exists on disk, and idempotent.

${chalk.green.bold("Arguments")}
  ${chalk.blue("<dir>")}                   The directory tsc emitted into, e.g. ${chalk.cyan("dist")}

${chalk.green.bold("Options")}
  ${chalk.blue("--check")}                 Report what would change and exit 1 if anything would
                          ${chalk.gray("(for CI — the build itself should just run the rewrite)")}

${chalk.green.bold("Where it runs")}
  The scaffold's ${chalk.cyan("config")} and ${chalk.cyan("backend")} build scripts, after ${chalk.cyan("tsc")}.
  ${chalk.cyan("rebase build")} already does the same to the bundle it writes.
`;

export async function normalizeImportsCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals, help } = parseCommandArgs({
        spec: NORMALIZE_IMPORTS_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "normalize-imports",
        maxPositionals: 1
    });

    if (help) {
        console.log(HELP);
        return;
    }

    const target = positionals[0] ?? "dist";
    const outDir = path.resolve(process.cwd(), target);

    // A missing directory is the common shape of "tsc did not run", and saying
    // so beats a rewrite that reports zero changes and looks like success.
    if (!fs.existsSync(outDir)) {
        throw new Error(
            `${target} does not exist — run your build first. `
            + "This step rewrites what the compiler emitted; it does not compile."
        );
    }

    const { rewritten, unresolved } = normalizeEsmSpecifiers(outDir);

    if (unresolved.length > 0) {
        console.log(chalk.yellow(`  ⚠ ${unresolved.length} relative import(s) resolve to no file:`));
        for (const specifier of unresolved.slice(0, 10)) {
            console.log(chalk.dim(`      ${specifier}`));
        }
        if (unresolved.length > 10) {
            console.log(chalk.dim(`      …and ${unresolved.length - 10} more`));
        }
        console.log(chalk.dim("    These will throw ERR_MODULE_NOT_FOUND at run time."));
    }

    if (flags["--check"]) {
        if (rewritten > 0 || unresolved.length > 0) {
            throw new Error(
                `${rewritten} import(s) are incomplete for Node ESM. `
                + `Run \`rebase normalize-imports ${target}\` as part of the build.`
            );
        }
        console.log(chalk.green(`✓ every relative import in ${target} is complete`));
        return;
    }

    console.log(
        rewritten > 0
            ? chalk.dim(`  completed ${rewritten} relative import(s) in ${target}/ for Node ESM`)
            : chalk.dim(`  ${target}/ — every relative import was already complete`)
    );
}
