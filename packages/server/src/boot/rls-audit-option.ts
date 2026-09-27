/**
 * The scheduled RLS audit, switched on from the environment.
 *
 * `REBASE_RLS_AUDIT=true` is how a bundle boot — the runtime image,
 * `rebase start`, `rebase dev` — asks for the audit, because a bundle has no
 * code path to `rlsAudit.enabled`. The variable also decides which process owns
 * the scan (`boot/role.ts`); this is the other half, without which a process
 * that owned the scan had none to run.
 *
 * The scanner is `@rebasepro/rls-check`, loaded from the bundle rather than
 * imported: the runtime deliberately carries no Postgres driver of its own (see
 * `rls-audit/index.ts`), so a project that wants the audit declares the package
 * among its dependencies and the bundle brings it.
 */
import type { RebaseBootEnv } from "./env";
import type { RlsAuditConfig, RlsScanner } from "../rls-audit";
import { BundleError } from "./bundle";
import { resolveBundlePackage } from "./driver";

export const RLS_CHECK_PACKAGE = "@rebasepro/rls-check";

/** The one export this needs from `@rebasepro/rls-check`. */
interface RlsCheckModule {
    scan?: RlsScanner;
}

/**
 * The `rlsAudit` option for a bundle boot: on, with the bundle's own scanner,
 * when `REBASE_RLS_AUDIT` is true; otherwise undefined.
 *
 * Refuses rather than booting without it. The variable is an explicit request
 * for a security audit, and a boot that quietly skipped it would report a
 * database as unaudited only to whoever thought to open the admin route.
 */
export async function resolveRlsAuditOptions(
    env: Pick<RebaseBootEnv, "REBASE_RLS_AUDIT">,
    resolveFrom: string[]
): Promise<RlsAuditConfig | undefined> {
    if (env.REBASE_RLS_AUDIT !== true) return undefined;

    // From the bundle's own tree only. The runtime ships no copy, so a bare
    // import could only find one that happens to sit above it on disk — not
    // something the project declared.
    const { specifier, packageDir } = resolveBundlePackage(RLS_CHECK_PACKAGE, resolveFrom);
    if (!packageDir) {
        throw new BundleError(
            `REBASE_RLS_AUDIT is set, but ${RLS_CHECK_PACKAGE} is not installed, so there is no scanner to run.`,
            `Add ${RLS_CHECK_PACKAGE} to the project's dependencies so the bundle carries it, ` +
            "or unset REBASE_RLS_AUDIT."
        );
    }

    let mod: RlsCheckModule;
    try {
        mod = await import(specifier) as RlsCheckModule;
    } catch (err) {
        throw new BundleError(
            `${RLS_CHECK_PACKAGE} failed while loading: ${err instanceof Error ? err.message : String(err)}`,
            `It is installed at ${packageDir}, and threw while being imported.`,
            { cause: err }
        );
    }

    if (typeof mod.scan !== "function") {
        throw new BundleError(
            `${RLS_CHECK_PACKAGE} exports no \`scan\` function.`,
            "Install a version of it that matches this runtime."
        );
    }
    return { enabled: true, scan: mod.scan };
}
