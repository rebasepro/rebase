/**
 * `rebase`, spelled the way the reader started this process.
 *
 * A hint that tells someone to run the CLI again — `init`'s "re-run it with
 * --yes" above all — used to print a bare `rebase …`. The quickstart's first
 * command is `pnpm dlx @rebasepro/cli init my-app`, and a reader who typed that
 * has no `rebase` on PATH: the one command the refusal offered was "command not
 * found". So the hint repeats the runner the reader used, at this CLI's exact
 * version, which is the version that printed it.
 *
 * Read from what the runners leave in the environment, never from guesses:
 *
 * - **`pnpm dlx`** sets `npm_config_user_agent` to `pnpm/…` and puts its cache
 *   entry's `node_modules/.bin` on PATH, under `<cache>/dlx/<key>/<dir>/`. It
 *   does not set `npm_command`.
 * - **`npx`** (`npm exec`) sets `npm_config_user_agent` to `npm/…`,
 *   `npm_command` to `exec`, and puts `~/.npm/_npx/<key>/node_modules/.bin` on
 *   PATH.
 *
 * Anything else — a global install, `pnpm exec rebase` in a project, a shell
 * alias — is answered with `rebase`, which is what those readers type.
 */
import path from "path";

import { cliVersion } from "./version";

/** A PATH entry that is a `pnpm dlx` cache entry's bin directory. */
const PNPM_DLX_BIN = /[\\/]dlx[\\/][^\\/]+[\\/][^\\/]+[\\/]node_modules[\\/]\.bin[\\/]?$/;

/** A PATH entry that is an `npx` cache entry's bin directory. */
const NPX_BIN = /[\\/]_npx[\\/][^\\/]+[\\/]node_modules[\\/]\.bin[\\/]?$/;

/**
 * The words to print in place of `rebase`: `["pnpm", "dlx", "@rebasepro/cli@0.25.0"]`,
 * `["npx", "-y", "@rebasepro/cli@0.25.0"]` or `["rebase"]`.
 *
 * `env` and `version` are parameters for the tests; a caller passes neither.
 */
export function invokedRebaseCommand(
    env: Readonly<Record<string, string | undefined>> = process.env,
    version: string = cliVersion()
): string[] {
    const agent = env.npm_config_user_agent ?? "";
    const binDirs = (env.PATH ?? "").split(path.delimiter);
    // The version that printed the hint, so re-running it runs the same CLI. A
    // version this cannot read names the package alone, which is still a
    // command that works.
    const spec = /^\d+\.\d+\.\d+/.test(version) ? `@rebasepro/cli@${version}` : "@rebasepro/cli";

    if (agent.startsWith("pnpm/") && binDirs.some(dir => PNPM_DLX_BIN.test(dir))) {
        return ["pnpm", "dlx", spec];
    }
    if (agent.startsWith("npm/") && env.npm_command === "exec" && binDirs.some(dir => NPX_BIN.test(dir))) {
        return ["npx", "-y", spec];
    }
    return ["rebase"];
}
