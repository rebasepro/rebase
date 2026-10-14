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
    downgradedPins,
    installCommand,
    isDowngrade,
    isExactVersion,
    planUpgrade,
    prereleaseChannel,
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
    "--allow-downgrade": Boolean,
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
                              (latest, canary). Default: latest — or, for a project
                              on a prerelease, its channel (canary), unless latest
                              is newer
  --allow-downgrade           Let a dist-tag move pins to an older release. Without
                              it that is refused; an exact --to version is taken
                              as asked
  --drop-local-overrides      Remove link: and file: overrides of @rebasepro packages,
                              which win over every pin
  --no-install                Rewrite the package.json files, but do not install
  --dry-run                   Print what would change, and write nothing
  --json                      One JSON document on stdout
  -h, --help                  Show this help

${chalk.bold("What it changes")}
  Every @rebasepro/* entry in dependencies, devDependencies and optionalDependencies,
  in every package.json under the project that git does not ignore (node_modules,
  dist* and hidden directories excepted, in a repository or not). ^ and ~ are kept.
  peerDependencies are left alone, and so are workspace:, link:, file:, git and tag
  specs, which are listed with the reason.
  Overrides in pnpm-workspace.yaml and package.json are bumped the same way, and so
  are the entries of pnpm-workspace.yaml's catalog: and catalogs: blocks, which is
  where a catalog: pin's version lives.

${chalk.bold("Examples")}
  rebase upgrade                          Move to the newest release on this project's channel
  rebase upgrade --to latest --allow-downgrade   Move a canary project back to stable
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
    /**
     * What the same command without `--dry-run` would refuse with, in the
     * `{ error }` envelope's terms; `null` when it would go ahead. Only a dry
     * run sets it: a real run that refuses prints that envelope instead.
     */
    wouldRefuse: UpgradeRefusal | null;
}

/** A refusal `rebase upgrade` answers with, as its `--json` envelope carries it. */
export interface UpgradeRefusal {
    code: string;
    message: string;
    hint?: string;
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

/**
 * The one release every moved pin came from, or `null` when they disagreed.
 * A range's `^`/`~` is not part of it: `upgrade --to` keeps each pin's operator.
 */
function previousRelease(plan: UpgradePlan): string | null {
    const versions = new Set(plan.changed.map(pin => pin.from.replace(/^[\^~]/, "")));
    if (versions.size !== 1) return null;
    const [version] = versions;
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ? version : null;
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

    const requested = flags["--to"];
    let plan: UpgradePlan;
    let channel: string | null = null;
    try {
        const npmView = (spec: string) => io.npmView(spec, projectRoot);
        const planFor = (target: string) =>
            planUpgrade(projectRoot, target, { dropLocalOverrides: flags["--drop-local-overrides"] === true });
        plan = planFor(await resolveTarget(requested ?? "latest", npmView));
        channel = prereleaseChannel(plan.changed.map(pin => pin.from));
        // A project on a prerelease stays on its channel by default: for a
        // canary scaffold `latest` is usually the release *before* it. The
        // channel wins only when it is ahead, so a stable release that has
        // overtaken the channel is still where "upgrade" goes.
        if (requested === undefined && channel) {
            const onChannel = await resolveTarget(channel, npmView).catch(() => null);
            if (onChannel && isDowngrade(onChannel, plan.target)) {
                if (!json) {
                    console.log(chalk.gray(`  This project is on the ${channel} channel, so this stays on it: ${channel} is ${onChannel}.`));
                    console.log(chalk.gray(`  \`rebase upgrade --to latest\` is the stable release, ${plan.target}.`));
                }
                plan = planFor(onChannel);
            }
        }
    } catch (err) {
        if (err instanceof UpgradeError) refuse(err.message, err.code, err.hint);
        throw err;
    }

    // Going backwards is never a side effect. A dist-tag — `latest` above all,
    // the default — that names an older release than the project is on is
    // refused unless asked for; an exact `--to` version already is asking.
    const backwards = downgradedPins(plan);
    const exactRequest = requested !== undefined && isExactVersion(requested.trim().replace(/^v(?=\d)/, ""));
    let downgradeRefusal: UpgradeRefusal | null = null;
    if (backwards.length > 0 && !exactRequest && flags["--allow-downgrade"] !== true) {
        const tag = requested?.trim() ?? "latest";
        const current = [...new Set(backwards.map(pin => pin.from.replace(/^[\^~]/, "")))].join(", ");
        downgradeRefusal = {
            code: "downgrade_refused",
            message: `\`${tag}\` is ${plan.target}, older than this project's ${current}: ` +
                `upgrading to it would move ${backwards.length} pin${backwards.length === 1 ? "" : "s"} backwards.`,
            hint: channel
                ? `Stay on the ${channel} channel with \`rebase upgrade --to ${channel}\`, or pass --allow-downgrade to move to ${plan.target}.`
                : `Pass --allow-downgrade to move to ${plan.target} anyway, or --to <version> for an exact release.`
        };
    }
    // A dry run goes on to show what would move, and says the real run would
    // stop here — in its document too, where an agent asking "would this work?"
    // reads the answer. Exit 0 either way, as the human output's warning does.
    if (downgradeRefusal && !dryRun) {
        refuse(`${downgradeRefusal.message} Nothing was changed.`, downgradeRefusal.code, downgradeRefusal.hint);
    }

    if (!dryRun) applyUpgradePlan(plan);
    const wrote = !dryRun && plan.writes.length > 0;
    const install = wrote && flags["--no-install"] !== true;
    const installer = detectInstaller(projectRoot);
    const [bin, args] = installCommand(installer);
    const installLine = [bin, ...args].join(" ");

    if (!json) {
        printSummary(plan, dryRun);
        if (backwards.length > 0) {
            const pins = `${backwards.length} pin${backwards.length === 1 ? "" : "s"}`;
            console.log(chalk.yellow(exactRequest || flags["--allow-downgrade"] === true
                ? `  ⚠ ${plan.target} is an older release than ${pins} here ${dryRun ? "are" : "were"} on: this is a downgrade.`
                : `  ⚠ ${plan.target} is an older release than ${pins} here are on. A real run refuses it without --allow-downgrade.`));
            console.log("");
        }
    }

    let installed = false;
    if (install) {
        if (!json) console.log(chalk.gray(`  Installing with ${installer}...\n`));
        try {
            await io.install([bin, args], projectRoot, json);
            installed = true;
        } catch {
            // The undo is a command this one already knows, when every pin it
            // moved came from one release: a mistyped `--to` (0.99.0 for
            // 0.29.0) is the commonest way here, and "revert with git" is no
            // answer in a project `rebase init --yes` never made a repository.
            const previous = previousRelease(plan);
            refuse(
                `\`${installLine}\` failed.`,
                "install_failed",
                `The package.json edits were kept. Fix what the install reported and run \`${installLine}\` again, ` +
                    (previous
                        ? `or put every pin back with \`rebase upgrade --to ${previous}\`.`
                        : "or revert the edits with git.")
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
        dryRun,
        wouldRefuse: dryRun ? downgradeRefusal : null
    };

    const databaseNotice = wrote ? await runningDatabaseNotice(projectRoot, plan.target) : [];

    if (json) {
        console.log(JSON.stringify(result, null, 2));
        for (const line of databaseNotice) console.error(line);
        return;
    }

    printOutcome(plan, { dryRun, wrote, installed, installLine, wouldRefuse: dryRun ? downgradeRefusal : null });
    if (databaseNotice.length > 0) {
        for (const line of databaseNotice) console.log(chalk.yellow(line));
        console.log("");
    }
}

/**
 * What to say about this project's managed database when an older CLI started
 * it, or nothing.
 *
 * The daemon outlives every command and the database proxy runs inside it, so
 * moving the pins does not move the proxy: the old one, with whatever the
 * upgrade fixed in it, kept serving until `rebase db stop` or thirty idle
 * minutes — and under a running `rebase dev` it never idles. The upgraded CLI
 * restarts it when nothing is connected (`daemonOutdated`); this says so, and
 * what to do while something is.
 */
export async function runningDatabaseNotice(projectRoot: string, target: string): Promise<string[]> {
    const { daemonOutdated, findRunningDaemon } = await import("../dev-db/daemon");
    const state = await findRunningDaemon(projectRoot);
    if (!state || !daemonOutdated(state.cliVersion, target)) return [];
    const startedBy = state.cliVersion ? `Rebase CLI ${state.cliVersion}` : "an earlier Rebase CLI";
    return [
        `⚠ This project's development database is still running, started by ${startedBy}, and its database proxy is that CLI's until it restarts.`,
        `  The next command that needs it restarts it on ${target} when nothing is connected to it. ` +
        "While `rebase dev` runs, stop it, then run `rebase db stop`. Data is kept."
    ];
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
    outcome: { dryRun: boolean; wrote: boolean; installed: boolean; installLine: string; wouldRefuse: UpgradeRefusal | null }
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
        // "Run it without --dry-run" is the one thing not to say after the
        // warning above that a real run refuses it: the last line is the one
        // acted on, so it names what to type instead.
        console.log(chalk.gray(moved === 0
            ? `  Nothing to change: this project is already on ${plan.target}.`
            : outcome.wouldRefuse
                ? `  Dry run — nothing was written, and a real run refuses it. ${outcome.wouldRefuse.hint}`
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
