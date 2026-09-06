/**
 * The argv `runAtlas` hands the Atlas binary, as a pure function.
 *
 * Split out of `cli.ts` because the flags an Atlas subcommand accepts are not
 * uniform and getting one wrong is fatal rather than degraded: Atlas rejects an
 * unknown flag before doing any work, so a flag on the wrong subcommand takes
 * the whole command down.
 *
 * `--exclude` is the one that bit. Of the six invocations here, exactly one
 * accepts it. The guard this replaces was `args.includes("apply") ||
 * args.includes("diff")`, and reading it as a *subcommand* test is the trap:
 * `migrate apply` passes `args.includes("apply")` just as `schema apply` does.
 * So the flag went onto three invocations, two of which reject it, and both
 * `rebase db generate` and `rebase db migrate` exited 1 with `unknown flag:
 * --exclude` for every project declaring a `search` block.
 *
 * The domain is half the identity of an Atlas subcommand, and a guard that
 * looks only at `args` cannot tell `schema apply` from `migrate apply`.
 *
 * Nothing here touches a database or the filesystem, so the whole matrix is
 * unit-tested in `atlas-argv.test.ts`.
 */

export interface AtlasInvocation {
    /** `schema` or `migrate`. */
    domain: string;
    /** The subcommand and its own flags, e.g. `["diff", "--dir", "file://…"]`. */
    args: string[];
    /** The target database, already rewritten for libpq. */
    url: string;
    /** The database Atlas plans against, already rewritten for libpq. */
    devUrl: string;
    /**
     * Everything the caller resolved for `--exclude`, in the order it should
     * appear. Dropped entirely when the subcommand does not accept the flag —
     * see {@link acceptsExcludeFlag}.
     */
    excludes?: string[];
}

/**
 * Does this Atlas invocation accept `--exclude`?
 *
 * Only `atlas schema apply` does, on the pinned 1.2.3. Measured against the
 * binary: `migrate diff` and `migrate apply` both answer `unknown flag:
 * --exclude`, and neither lists it in `--help` (`migrate apply` offers
 * `--url/--dir/--format/--revisions-schema/--dry-run/--lock-name/--lock-timeout/`
 * `--skip-lock/--baseline/--to-version/--tx-mode/--exec-order/--allow-dirty`).
 * Hence `domain === "schema"` and not just the subcommand.
 *
 * The `exclude` attribute of an `atlas.hcl` `env` block is not a way round it
 * either: measured, it is accepted and then ignored on the diff path, which is
 * the silent-no-match shape that costs the most time to notice.
 *
 * So the diff keeps the carved-out objects out of the migration afterwards
 * instead, with `stripCarvedOutStatements`.
 */
export function acceptsExcludeFlag(domain: string, args: string[]): boolean {
    return domain === "schema" && args.includes("apply");
}

/** Assemble the full argv, connection flags and all. */
export function buildAtlasArgs(invocation: AtlasInvocation): string[] {
    const { domain, args, url, devUrl, excludes = [] } = invocation;
    const argv = [domain, ...args];

    if (domain === "schema") {
        if (args.includes("apply")) {
            argv.push("--url", url, "--dev-url", devUrl);
        } else if (args.includes("clean") || args.includes("inspect")) {
            argv.push("--url", url);
        }
    } else if (domain === "migrate") {
        if (args.includes("diff")) {
            argv.push("--dev-url", devUrl);
        } else if (args.includes("apply") || args.includes("status")) {
            argv.push("--url", url, "--revisions-schema", "rebase");
            // Measured against the pinned binary: `sql/migrate: baseline and
            // allow-dirty are mutually exclusive`. `--baseline` is the caller's
            // explicit answer to the same question `--allow-dirty` answers by
            // default, so it wins, and adding both would refuse the command.
            if (args.includes("apply") && !args.includes("--baseline")) {
                argv.push("--allow-dirty");
            }
        }
    }

    // Second line of defence, deliberately not a caller's responsibility: a
    // future caller that resolves excludes for the diff path gets them dropped
    // here rather than a command that will not run.
    if (acceptsExcludeFlag(domain, args)) {
        for (const exclude of excludes) {
            argv.push("--exclude", exclude);
        }
    }

    return argv;
}
