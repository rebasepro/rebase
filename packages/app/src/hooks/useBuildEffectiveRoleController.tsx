import type { EffectiveRoleController } from "@rebasepro/types";
import { warnDeprecated } from "@rebasepro/common";
import { useEffectiveRoleState } from "../core/effective_role_state";

/**
 * Build an effective role controller: which role Studio's navigation is
 * listed for when Dev mode is active, kept in localStorage across reloads.
 *
 * Navigation only: it changes which Studio views are listed, sends nothing to
 * the server and evaluates no row-level security policy.
 *
 * @deprecated To see what a role, a user or an API key can read and do, use
 * "Simulate access" (`useRlsSimulation`, `client.simulate()`), which asks the
 * server. `<Rebase>` builds its own effective role controller when none is
 * passed, so there is no need to build one.
 */
export function useBuildEffectiveRoleController(): EffectiveRoleController {
    warnDeprecated(
        "useBuildEffectiveRoleController",
        "`useBuildEffectiveRoleController` is deprecated. It only changes which Studio views are listed and " +
        "tests no permission. To see what a role, user or API key can read, use Simulate access " +
        "(`useRlsSimulation`, `client.simulate()`). `<Rebase>` builds its own controller when none is passed."
    );
    return useEffectiveRoleState();
}
