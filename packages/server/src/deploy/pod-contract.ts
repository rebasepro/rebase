/**
 * What every deployment of this runtime must get right about the pod.
 *
 * There are two things that place a Rebase runtime in Kubernetes — the Helm
 * chart in `charts/rebase`, for self-hosting, and the control plane's
 * `buildManagedContainer`, for cloud tenants — and they were written months
 * apart by people solving different problems. Rendering both for the same unit
 * and diffing them (2026-08-22) turned up four disagreements, and in three of
 * them the chart was doing the thing this runtime's own source warns against.
 *
 * The disagreements were not in the parts that *should* differ. A managed pod
 * takes its environment from a tenant Secret and a self-hosted one takes it from
 * a values file; a managed pod is scheduled onto spot capacity its plan sold it
 * and a self-hosted one goes where the operator says. Those are different jobs
 * and they produce different manifests, correctly.
 *
 * What must not differ is anything that is really a statement about *this
 * process*: which endpoint answers what, which variables decide the topology,
 * where the bundle is mounted. Those are not deployment preferences. They are
 * facts about the runtime, and a deployment that gets one wrong produces a
 * cluster that looks healthy — which is why they are stated here, in the
 * runtime, rather than twice in the things that deploy it.
 *
 * The chart cannot import this module. `scripts/check-chart.mjs` renders the
 * chart and asserts it against these values instead, so the chart conforms by
 * gate where the control plane conforms by construction.
 */

/**
 * Endpoints this runtime guarantees on every role, and what each one means.
 *
 * `/livez` is dependency-free — it answers "this process is running" and
 * nothing else. `/health` opens the default driver and every configured
 * secondary, and **answers 503 when any of them is unreachable**
 * (`boot.ts`, the `healthPaths` handler).
 *
 * That difference is the whole reason both exist, and it is stated at the
 * `/livez` registration in `boot.ts`: "`/health` touches the database, so a
 * database blip would make an orchestrator kill an otherwise healthy process."
 */
export const RUNTIME_HEALTH_PATH = "/health";
export const RUNTIME_LIVENESS_PATH = "/livez";

/**
 * Which endpoint each Kubernetes probe must target.
 *
 * The rule follows from what the probe *does* when it fails:
 *
 * - **liveness** restarts the container. A database outage must therefore never
 *   fail it, or an unreachable database turns into a cluster-wide restart loop
 *   that clears the moment the database returns and looks, in the logs, like
 *   the application crashed. `/livez`.
 * - **readiness** removes the pod from its Service. That is exactly what should
 *   happen when the database is unreachable — the pod cannot serve. `/health`.
 * - **startup** decides when the other two begin. Its job is "has this process
 *   finished booting", and booting may include fetching a bundle, installing
 *   dependencies and checking the schema. It must not also require the database
 *   to be *up*, or a cold database is indistinguishable from a broken image:
 *   the pod never passes startup, liveness never gets to run, and the pod
 *   CrashLoops with nothing in its output about a database. `/livez`.
 *
 * A probe targeting the wrong one of these fails silently in the direction that
 * looks like an application bug, which is why this is a contract and not a
 * default.
 */
export const RUNTIME_PROBE_PATHS = {
    liveness: RUNTIME_LIVENESS_PATH,
    readiness: RUNTIME_HEALTH_PATH,
    startup: RUNTIME_LIVENESS_PATH
} as const;

/**
 * Environment variables that decide *topology* — which surfaces a process
 * mounts, which singletons it owns, where it forwards.
 *
 * These are the platform's or the operator's decision expressed by the thing
 * doing the deploying, and they must never be settable by whoever supplies the
 * project's own environment. The cloud learned this the expensive way: a tenant
 * who set `REBASE_ROLE=worker` in their project variables got a pod that served
 * no HTTP at all, and because `/health` answers on **every** role the readiness
 * probe passed, the rollout reported success, and every request 404'd.
 *
 * Kubernetes only lets `env` shadow `envFrom` for names it **lists**, so
 * neutralising one of these means naming it explicitly. An empty value is read
 * by the runtime as unset, which is why the cloud pins most of them to `""`
 * rather than to a value: the entry exists to take the decision away from the
 * project, not to make it here.
 */
export const TOPOLOGY_ENV_VARS = [
    "REBASE_ROLE",
    "REBASE_FUNCTIONS_ONLY",
    "REBASE_FUNCTIONS_EXCLUDE",
    "REBASE_FUNCTIONS_UPSTREAM",
    "REBASE_CRON_SCHEDULER",
    "REBASE_JOB_WORKERS",
    "REBASE_MIGRATE_ON_BOOT",
    "TRUSTED_PROXY_HOPS",
    "REBASE_RATE_LIMIT_STORE",
    "REBASE_REQUIRE_SCHEMA_MATCH"
] as const;

export type TopologyEnvVar = (typeof TOPOLOGY_ENV_VARS)[number];

/** Whether a variable name is one the deployer owns rather than the project. */
export function isTopologyEnvVar(name: string): name is TopologyEnvVar {
    return (TOPOLOGY_ENV_VARS as readonly string[]).includes(name);
}

/**
 * Seconds to keep answering after Kubernetes decides to remove this pod.
 *
 * `installShutdownHandlers` drains on SIGTERM — it stops the scheduler, tears
 * down realtime and closes the HTTP server, finishing what is in flight. What
 * it cannot do is stop *new* requests arriving: kubelet sends SIGTERM and the
 * endpoint controller removes the pod from its Service **concurrently**, so for
 * as long as endpoint removal takes to propagate, the ingress is still routing
 * to a process that has already stopped accepting connections.
 *
 * A `preStop` sleep is the only thing that orders those two. The pod keeps
 * serving for this long *before* SIGTERM is sent, which is time the ingress
 * uses to stop sending it anything.
 *
 * Anything greater than zero fixes the ordering; five seconds is what the
 * control plane has run in production.
 */
export const RUNTIME_PRESTOP_DRAIN_SECONDS = 5;

/**
 * The floor for `terminationGracePeriodSeconds`.
 *
 * The pod must outlive `preStop` *plus* the drain that follows it, or kubelet
 * SIGKILLs mid-drain and the graceful shutdown was decoration. The drain's own
 * default is 15s (`ShutdownHandlerOptions.timeoutMs`), and Kubernetes' default
 * grace period is 30s — so the stock configuration has room, and this exists to
 * say how much before someone raises the drain.
 */
export const RUNTIME_MIN_TERMINATION_GRACE_SECONDS =
    RUNTIME_PRESTOP_DRAIN_SECONDS + 15;

/**
 * How long a deployment must let this runtime take to answer for the first time.
 *
 * Nothing answers until boot is finished. `runFromBundle` binds the socket
 * **last** — after the bundle is read, the drivers connect and, on the process
 * that owns it, the schema DDL runs (`boot.ts`, "schema DDL happens during
 * boot, above"). So the gap between the container starting and `/livez`
 * answering is a whole provisioning run, not a framework warming up.
 *
 * A deployment with no startup probe measures that gap with its *liveness*
 * probe instead, and liveness restarts the container. On the control plane's
 * settings that is 20s of grace plus three 20s failures — 80 seconds — after
 * which a slow first boot is killed and retried, and each retry starts from the
 * beginning. It does not converge; it loops, and the logs show a pod that never
 * finished starting rather than a database that was slow.
 *
 * So a startup probe is not optional here, and its budget is this. A healthy
 * pod passes it on the first check and nothing is spent.
 */
export const RUNTIME_STARTUP_BUDGET_SECONDS = 300;

/** Where a bundle is mounted, and what the runtime is told to read. */
export const RUNTIME_BUNDLE_MOUNT = "/bundle";
