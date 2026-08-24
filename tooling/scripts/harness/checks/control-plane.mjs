/**
 * There are two control planes, and only one of them is production.
 *
 * `app.rebase.pro` is served by a GKE Deployment with in-cluster Postgres. A separate,
 * older Cloud Run + Cloud SQL stack still exists, still deploys, still returns success —
 * and serves nothing. Terraform changes to that stack's environment never reach
 * production either. The failure mode is not an error; it is a green deploy followed by
 * "the fix didn't work", because the fix went somewhere nobody is looking.
 *
 * `rebase-demo` on Cloud Run is the legitimate exception — the demo really does live
 * there — so this classifies by target, not by tool.
 *
 * Unlike the other checks this one inspects a *proposed command* rather than the working
 * tree, because it has to fire before the deploy, not after.
 */
import { finding, pass, WARN, FAIL } from "../lib/report.mjs";

export const id = "control-plane";
export const title = "Deploy targets the plane that actually serves prod";

/** Commands that put code or config somewhere real. */
const DEPLOY_SHAPED = [
    /\bgcloud\s+run\s+deploy\b/,
    /\bgcloud\s+builds\s+submit\b/,
    /\bkubectl\s+(apply|set\s+image|rollout\s+restart|delete)\b/,
    /\bterraform\s+apply\b/,
    /\brebase\s+cloud\s+deploy\b/,
    /\bpnpm\s+(run\s+)?deploy(:\w+)?\b/,
];

/** Cloud Run services that are genuinely their own product, not a stale prod mirror. */
const LEGITIMATE_CLOUD_RUN = [/rebase-demo/];

export function isDeployShaped(command = "") {
    return DEPLOY_SHAPED.some((re) => re.test(command));
}

export function run(_ctx, { command = "" } = {}) {
    if (!command || !isDeployShaped(command)) return [pass(id, "No deploy-shaped command to classify.")];

    const found = [];

    if (/\bgcloud\s+run\s+deploy\b/.test(command) && !LEGITIMATE_CLOUD_RUN.some((re) => re.test(command))) {
        found.push(
            finding(
                id,
                WARN,
                `This deploys to Cloud Run. app.rebase.pro is served by the GKE cluster — a Cloud Run deploy will succeed and change nothing in production.`,
                `If you meant production, deploy to the GKE Deployment instead. If you meant the demo, the service name should be rebase-demo.`,
            ),
        );
    }

    if (/\bterraform\s+apply\b/.test(command)) {
        found.push(
            finding(
                id,
                WARN,
                `Terraform manages the non-serving stack. Environment changes applied here do not reach the running production workload.`,
                `Change the GKE Deployment / cluster Secret directly for anything prod must actually observe.`,
            ),
        );
    }

    if (/\bkubectl\s+delete\b/.test(command)) {
        found.push(
            finding(
                id,
                FAIL,
                `kubectl delete against a cluster that hosts production and tenant workloads.`,
                `Confirm the target namespace and context with the user before running any destructive kubectl verb.`,
            ),
        );
    }

    return found.length ? found : [pass(id, "Deploy target looks consistent with the serving control plane.")];
}
