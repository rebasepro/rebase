/**
 * `REBASE_PROVISION_ONLY`, read the one way every caller reads it.
 *
 * Its own module, with nothing imported, so `tooling/scripts/chart-unit-roles.mts`
 * can ask the same question of a rendered chart unit without loading the boot.
 */

/**
 * Whether this process should provision the schema and stop, rather than serve.
 *
 * The shape a migration Job wants: same image, same bundle, same boot — and no
 * socket. Nothing else changes, which is the point. A separate migration image
 * would be a second artifact to build, publish and keep in step with the
 * runtime, and the failure mode of it drifting is a schema applied by a version
 * that is not the one about to run against it.
 *
 * A blank value is *unset*: `REBASE_PROVISION_ONLY=${SOMETHING}` with SOMETHING
 * undefined is the ordinary way to write a compose file or a Helm template, and
 * reading it as true would turn an ordinary deployment into one that migrates
 * and then refuses to serve.
 */
export function resolveProvisionOnly(env: { REBASE_PROVISION_ONLY?: string }): boolean {
    const raw = (env.REBASE_PROVISION_ONLY ?? "").trim().toLowerCase();
    return raw === "1" || raw === "true";
}
