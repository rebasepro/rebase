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

/**
 * Any `kubectl` invocation whose verb is one that changes something.
 *
 * The flags go between `kubectl` and the verb, and almost nobody writes the
 * verb first. This used to require them adjacent — `\bkubectl\s+(apply|…)\b` —
 * so `kubectl -n rebase-shared delete cluster pg-pool-1` was not classified as
 * deploy-shaped at all, and the destructive-verb rule below never ran for it.
 *
 * That is the form a namespaced deletion actually takes, which made the check
 * blind to essentially every deletion that could destroy tenant data. On
 * 2026-09-13 a CloudNativePG cluster and two 100 GiB volumes were deleted with
 * this silent. What it did catch, minutes later, was the same operation spelled
 * without a flag between the two words.
 *
 * Two things keep prose out.
 *
 * **Position.** `kubectl` has to START a command — the beginning of the string,
 * or just after a separator, newline, or opening quote. In a command it always
 * does; in a sentence it is preceded by a word ("the kubectl gate", "we use
 * kubectl for"). Length alone cannot tell those apart: an unbounded gap made
 * any paragraph containing both words a match, and bounding it at 160
 * characters did not help, because a clause fits in 160 characters easily. The
 * commit message describing this fix was refused by the rule it describes,
 * twice.
 *
 * A refusal is the safe direction to be wrong in, but a gate that cries wolf on
 * documentation teaches people to route around it, and routing around this one
 * is a single reordered flag.
 *
 * **Separators.** The gap excludes `|`, `;` and `&`, so `kubectl get pods |
 * grep delete` is a read. It keeps newlines, so a backslash-continued command
 * still matches.
 */
const KUBECTL_VERB =
    /(?:^|[;&|\n('"`])\s*(?:sudo\s+)?kubectl\b[^|;&]*?\s(apply|delete|set\s+image|rollout\s+restart)\b/;

/** Commands that put code or config somewhere real. */
const DEPLOY_SHAPED = [
    /\bgcloud\s+run\s+deploy\b/,
    /\bgcloud\s+builds\s+submit\b/,
    KUBECTL_VERB,
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

    // The same adjacency bug as KUBECTL_VERB, and the one that mattered: this
    // is the rule that BLOCKS, and it only ever saw the two words side by side.
    // Same command-start requirement, for the same reason.
    if (/(?:^|[;&|\n('"`])\s*(?:sudo\s+)?kubectl\b[^|;&]*?\sdelete\b/.test(command)) {
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
