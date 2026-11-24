/**
 * The hint for a project whose dependencies were never installed.
 *
 * `rebase init --yes` scaffolds without installing, and `rebase cloud init
 * --claim` deploys straight after. Run in that order, every schema module fails
 * to import with "Cannot find module '@rebasepro/server/schema'", which reads
 * like a broken schema rather than a missing `npm install`. When the failures
 * are about Rebase's own packages, say what to run.
 */
import { detectPackageManager, getPMCommands } from "./package-manager";

const MISSING_REBASE_MODULE = /Cannot find module '@rebasepro\//;

export function missingDependenciesHint(
    messages: readonly string[],
    projectRoot: string,
    env: Readonly<Record<string, string | undefined>> = process.env
): string | undefined {
    if (!messages.some(m => MISSING_REBASE_MODULE.test(m))) return undefined;
    const install = getPMCommands(detectPackageManager(projectRoot, env)).install.join(" ");
    return `The project's dependencies are not installed. Run \`${install}\` in ${projectRoot}, then deploy again.`;
}
