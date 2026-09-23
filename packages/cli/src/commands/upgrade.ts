/**
 * CLI command: rebase upgrade [--to <version|tag>]
 *
 * Moves every `@rebasepro/*` package the project pins to one release, then
 * installs. The file work — which specs move, the rewrite, what overrides say —
 * is `../upgrade.ts`; this adds the registry lookup for a tag, the install, and
 * the two ways of saying what happened.
 */
import chalk from "chalk";
import { execa } from "execa";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { failAsJson, requireProjectRoot, type JsonFailureIssue } from "../utils/project";
import { loadManifest, ManifestError } from "../manifest";
import {
    applyUpgradePlan,
    detectInstaller,
    installCommand,
    isDowngrade,
    planUpgrade,
    resolveTarget,
    UpgradeError,
    type ChangedPin,
    type OverrideFinding,
    type SkippedSpec,
    type UnreadableFile,
    type UpgradePlan
} from "../upgrade";

/** Every flag `rebase upgrade` accepts. Its help page and the docs verifier read this. */
export const UPGRADE_FLAGS = {
    "--to": String,
    "--drop-local-overrides": Boolean,
    "--no-install": Boolean,
    "--dry-run": Boolean,
    "--json": Boolean
} as const;

function printHelp(): void {
    console.log(`
${chalk.bold("rebase upgrade")} — move every @rebasepro package this project pins to one release

${chalk.bold("Usage")}
  rebase upgrade [--to <version|tag>] [options]

${chalk.bold("Options")}
  --to <version|tag>          The release: an exact version (0.21.0) or a dist-tag
                              (latest, canary). Default: latest
  --drop-local-overrides      Remove link: and file: overrides of @rebasepro packages,
                              which win over every pin
  --no-install                Rewrite the package.json files, but do not install
  --dry-run                   Print what would change, and write nothing
  --json                      One JSON document on stdout
  -h, --help                  Show this help

${chalk.bold("What it changes")}
  Every @rebasepro/* entry in dependencies, devDependencies and optionalDependencies,
  in every package.json under the project (node_modules, dist* and hidden
  directories excepted). ^ and ~ are kept. peerDependencies are left alone, and so
  are workspace:, link:, file:, git and tag specs, which are listed with the reason.
  Overrides in pnpm-workspace.yaml and package.json are bumped the same way, and so
  are the entries of pnpm-workspace.yaml's catalog: and catalogs: blocks, which is
  where a catalog: pin's version lives.

${chalk.bold("Examples")}
  rebase upgrade                          Move to the latest release and install
  rebase upgrade --to canary --dry-run    See what the canary would change
  rebase upgrade --to 0.21.0 --no-install --json
`.trim());
}

/** What the command reports, human or `--json`. */
export interface UpgradeResult {
    target: string;
    changed: ChangedPin[];
    skipped: SkippedSpec[];
    overrides: OverrideFinding[];
    unreadable: UnreadableFile[];
    installed: boolean;
    dryRun: boolean;
}

/**
 * The two things this command does outside the project's files: ask the
 * registry what a tag points at, and install. Injectable, so a test runs the
 * whole command without either.
 */
export interface UpgradeIo {
    npmView: (spec: string, cwd: string) => Promise<string>;
    /** `quietStdout`: route the installer's stdout to stderr, so `--json` keeps stdout to itself. */
    install: (command: [string, string[]], cwd: string, quietStdout: boolean) => Promise<void>;
}

const defaultIo: UpgradeIo = {
    // Run in the project, so its `.npmrc` — a private registry, a scope
    // mapping — answers the question rather than whatever the CLI was run from.
    npmView: async (spec, cwd) => {
        try {
            return (await execa("npm", ["view", spec, "version"], { cwd })).stdout;
        } catch (err) {
            throw new Error(npmFailure(err));
        }
    },
    install: async ([bin, args], cwd, quietStdout) => {
        await execa(bin, args, { cwd, stdio: quietStdout ? ["ignore", 2, "inherit"] : "inherit" });
    }
};

/**
 * The one line of a failed `npm view` worth printing.
 *
 * execa's own message is the command line that failed, which says nothing the
 * reader does not know. npm's stderr says why — `404 No match found for version
 * nosuchtag` — under an `npm error code E404` line that says less.
 */
export function npmFailure(err: unknown): string {
    const stderr = typeof err === "object" && err !== null && "stderr" in err && typeof err.stderr === "string"
        ? err.stderr
        : "";
    const reason = stderr
        .split("\n")
        .map(line => line.replace(/^npm (?:error|ERR!)\s*/, "").trim())
        .find(line => line !== "" && !/^code\s/.test(line) && !/^\d{3}$/.test(line));
    return reason ?? (err instanceof Error ? err.message : String(err));
}

export async function upgradeCommand(rawArgs: string[], io: UpgradeIo = defaultIo): Promise<void> {
    if (wantsHelp(rawArgs)) {
        printHelp();
        return;
    }

    const { flags } = parseCommandArgs({
        spec: UPGRADE_FLAGS,
        rawArgs,
        commandWords: 1,
        command: "upgrade",
        maxPositionals: 0
    });
    const json = flags["--json"] === true;
    const dryRun = flags["--dry-run"] === true;

    const projectRoot = requireProjectRoot();

    /** Every refusal, in whichever of the two languages was asked for. */
    const refuse = (message: string, code: string, hint?: string, issues?: JsonFailureIssue[]): never => {
        if (json) failAsJson(message, code, hint, issues);
        console.error(chalk.red(`✗ ${message}`));
        for (const issue of issues ?? []) console.error(`  ${chalk.gray(issue.path ?? "")} ${issue.message}`);
        if (hint) console.error(chalk.gray(`  ${hint}`));
        process.exit(1);
    };

    // A project whose rebase.json does not load cannot be built on any release,
    // so moving its pins would only move the failure. Said first, and in the
    // same envelope `rebase status` uses.
    try {
        loadManifest(projectRoot);
    } catch (err) {
        if (err instanceof ManifestError) {
            refuse(err.message, "manifest_invalid", "Fix rebase.json, then run this again.",
                err.issues.map(issue => ({ path: issue.path, message: issue.message })));
        }
        throw err;
    }

    let plan: UpgradePlan;
    try {
        const target = await resolveTarget(flags["--to"] ?? "latest", spec => io.npmView(spec, projectRoot));
        plan = planUpgrade(projectRoot, target, { dropLocalOverrides: flags["--drop-local-overrides"] === true });
    } catch (err) {
        if (err instanceof UpgradeError) refuse(err.message, err.code, err.hint);
        throw err;
    }

    if (!dryRun) applyUpgradePlan(plan);
    const wrote = !dryRun && plan.writes.length > 0;
    const install = wrote && flags["--no-install"] !== true;
    const installer = detectInstaller(projectRoot);
    const [bin, args] = installCommand(installer);
    const installLine = [bin, ...args].join(" ");

    if (!json) printSummary(plan, dryRun);

    let installed = false;
    if (install) {
        if (!json) console.log(chalk.gray(`  Installing with ${installer}...\n`));
        try {
            await io.install([bin, args], projectRoot, json);
            installed = true;
        } catch {
            refuse(
                `\`${installLine}\` failed.`,
                "install_failed",
                `The package.json edits were kept. Fix what the install reported and run \`${installLine}\` again, ` +
                    "or revert the edits with git."
            );
        }
    }

    const result: UpgradeResult = {
        target: plan.target,
        changed: plan.changed,
        skipped: plan.skipped,
        overrides: plan.overrides,
        unreadable: plan.unreadable,
        installed,
        dryRun
    };

    if (json) {
        console.log(JSON.stringify(result, null, 2));
        return;
    }

    printOutcome(plan, { dryRun, wrote, installed, installLine });
}

/** Changes grouped by file, then what was left alone and why, then overrides. */
function printSummary(plan: UpgradePlan, dryRun: boolean): void {
    console.log("");
    console.log(`${chalk.bold("Rebase")} — ${dryRun ? "what upgrading" : "upgrading"} @rebasepro packages to ${chalk.cyan(plan.target)}${dryRun ? " would change" : ""}`);

    const byFile = new Map<string, ChangedPin[]>();
    for (const pin of plan.changed) byFile.set(pin.file, [...(byFile.get(pin.file) ?? []), pin]);
    const nameWidth = Math.max(0, ...plan.changed.map(pin => pin.name.length));
    for (const [file, pins] of byFile) {
        console.log("");
        console.log(`  ${chalk.bold(file)}`);
        for (const pin of pins) {
            const field = pin.field === "dependencies" ? "" : chalk.gray(`  ${pin.field}`);
            const older = isDowngrade(pin.from, pin.to) ? chalk.yellow("  (older)") : "";
            console.log(`    ${pin.name.padEnd(nameWidth)}  ${chalk.gray(pin.from)} → ${chalk.green(pin.to)}${field}${older}`);
        }
    }

    if (plan.skipped.length > 0) {
        console.log("");
        console.log(`  ${chalk.bold("Left alone")}`);
        for (const skip of plan.skipped) {
            console.log(`    ${skip.name}  ${chalk.gray(skip.spec)}  ${chalk.gray(`(${skip.file}, ${skip.field})`)}`);
            console.log(chalk.gray(`      ${skip.reason}`));
        }
    }

    if (plan.overrides.length > 0) {
        console.log("");
        console.log(`  ${chalk.bold("Overrides")}`);
        for (const override of plan.overrides) {
            const where = chalk.gray(`(${override.file})`);
            if (override.action === "bumped") {
                console.log(`    ${override.name}  ${chalk.gray(override.spec)} → ${chalk.green(override.to ?? "")}  ${where}`);
            } else if (override.action === "removed-local") {
                console.log(`    ${override.name}  ${chalk.gray(override.spec)}  ${where}  ${chalk.green(dryRun ? "would be removed" : "removed")}`);
            } else {
                console.log(`    ${chalk.yellow("⚠")} ${override.name} → ${override.spec}  ${where}`);
                console.log(chalk.yellow("      local override — wins over every pin, the upgrade will not reach these packages"));
            }
        }
        if (plan.overrides.some(o => o.action === "kept-local")) {
            console.log(chalk.gray("      Run again with --drop-local-overrides to remove them."));
        }
    }

    if (plan.unreadable.length > 0) {
        console.log("");
        console.log(`  ${chalk.bold("Not read")}`);
        for (const entry of plan.unreadable) {
            console.log(`    ${entry.file}  ${chalk.gray(entry.reason)}`);
        }
    }
    console.log("");
}

function printOutcome(
    plan: UpgradePlan,
    outcome: { dryRun: boolean; wrote: boolean; installed: boolean; installLine: string }
): void {
    const moved = plan.changed.length + plan.overrides.filter(o => o.action !== "kept-local").length;
    // What the project is not moved off by this command: every pin it left
    // alone, and every local override that wins over the pins it did move.
    const leftAlone = plan.skipped.length + plan.overrides.filter(o => o.action === "kept-local").length;
    const entries = (n: number): string => `${n} entr${n === 1 ? "y" : "ies"}`;

    // Nothing moved is only "already on" the target when nothing was left
    // alone either. A project whose every pin was skipped — a dist-tag, a
    // `workspace:` link, a catalog it could not find — is on whatever those
    // resolve to, and saying otherwise is the one sentence it must not print.
    if (moved === 0 && leftAlone > 0) {
        if (plan.unchanged > 0) {
            console.log(chalk.green(
                `✓ Every pin this can move is already on ${plan.target}; ${entries(leftAlone)} ${leftAlone === 1 ? "was" : "were"} left alone, above.`));
        } else if (outcome.dryRun) {
            console.log(chalk.yellow(
                `  Nothing to move to ${plan.target}: ${entries(leftAlone)} ${leftAlone === 1 ? "is" : "are"} left alone, above.`));
        } else {
            console.log(chalk.yellow(
                `⚠ Nothing moved to ${plan.target}: ${entries(leftAlone)} ${leftAlone === 1 ? "was" : "were"} left alone, above.`));
        }
        console.log("");
        return;
    }

    if (outcome.dryRun) {
        console.log(chalk.gray(moved === 0
            ? `  Nothing to change: this project is already on ${plan.target}.`
            : "  Dry run — nothing was written. Run it without --dry-run to apply."));
        console.log("");
        return;
    }

    if (!outcome.wrote) {
        console.log(chalk.green(`✓ This project is already on ${plan.target}.`));
        console.log("");
        return;
    }

    const files = plan.writes.length;
    console.log(chalk.green(
        `✓ Moved ${moved} entr${moved === 1 ? "y" : "ies"} in ${files} file${files === 1 ? "" : "s"} to ${plan.target}` +
            `${outcome.installed ? " and installed" : ""}.`
    ));
    if (!outcome.installed) {
        console.log(chalk.gray(`  Install with \`${outcome.installLine}\`, then run \`rebase build\`, then \`rebase cloud deploy\`.`));
    } else {
        console.log(chalk.gray("  Run `rebase build`, then `rebase cloud deploy`."));
    }
    console.log("");
}
