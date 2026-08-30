/**
 * Turning a control-plane failure into something the caller can act on.
 *
 * The control plane talks to Kubernetes, and when Kubernetes refuses it, the
 * refusal travels back verbatim: a whole `Status` object, the request headers,
 * an `audit-id`, an `x-kubernetes-pf-flowschema-uid`. That reached the user's
 * terminal unedited. Two things are wrong with it beyond the noise.
 *
 * The first is that the one sentence that matters is buried in the middle of a
 * JSON blob, so the remedy — if there is one — is the hardest part to find.
 *
 * The second is worse, and is the reason this file exists rather than a
 * `slice(0, 200)`. A `403` naming a `system:serviceaccount:` is a statement
 * about the PLATFORM's own credentials: some role the control plane runs as is
 * missing a grant. Nothing in the user's project can change that — not the
 * collections, not `rebase.json`, not the deploy flags — and the error, printed
 * raw in the middle of `rebase cloud deploy`, reads exactly like a project
 * fault. Someone acting on that reading deletes working code looking for the
 * cause. (That is not hypothetical: three cron jobs were removed from a project
 * to test whether they caused a `cronjobs.batch` 403. They did not.)
 *
 * So this classifies before it summarises, and says whose problem it is.
 */

/** What a Kubernetes API refusal carries, once it is found. */
export interface KubernetesStatus {
    message?: string;
    reason?: string;
    code?: number;
    details?: { group?: string; kind?: string; name?: string };
}

export interface ErrorSummary {
    /** One line, safe to print. Never the raw body. */
    message: string;
    /** A remedy, when one exists — or the reason there is none. */
    hint?: string;
    /** A stable code for `--json` callers to branch on. */
    code: string;
    /**
     * Whether the failure is the platform's rather than the project's.
     *
     * The whole point of the summary: a caller that retries or mutates the
     * project on a platform-side refusal makes things worse, and an agent
     * cannot tell from the prose.
     */
    platform: boolean;
    /** The untouched original, printed only under `--debug`. */
    raw: string;
}

/**
 * The service accounts a Kubernetes 403 can name, and what each means.
 *
 * `system:serviceaccount:` is the platform's own identity — the control plane's
 * pod, or a tenant's operator. A project cannot grant it anything, because the
 * grant lives in a cluster the project does not own. `system:anonymous` is the
 * same fact with the credential missing entirely.
 */
const PLATFORM_PRINCIPAL_RE = /system:(?:serviceaccount:|anonymous|node:)/;

/**
 * A Kubernetes `Status` object embedded anywhere in a message.
 *
 * Scanned for rather than parsed off the front: the control plane wraps it
 * ("Failed to create the tenant namespace: …"), the client library appends
 * headers after it, and both halves are worth keeping out of the summary.
 * Balanced-brace scanning rather than a regex, because `details.causes` nests
 * and a lazy `\{.*?\}` truncates the object at the first inner brace — which
 * parses to nothing and silently falls through to the raw message.
 */
export function extractKubernetesStatus(text: string): KubernetesStatus | undefined {
    for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
        let depth = 0;
        let inString = false;
        let escaped = false;
        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString) continue;
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth !== 0) continue;
                const candidate = text.slice(start, i + 1);
                let parsed: unknown;
                try {
                    parsed = JSON.parse(candidate);
                } catch {
                    break; // Not JSON; try the next opening brace.
                }
                const obj = parsed as Record<string, unknown> & KubernetesStatus;
                // `kind: "Status"` is the marker the API server always sets on a
                // refusal. Requiring it means an ordinary JSON body in an error
                // message — a validation report, say — is left alone.
                if (obj?.kind === "Status" || (obj?.status === "Failure" && typeof obj.code === "number")) {
                    return {
                        message: typeof obj.message === "string" ? obj.message : undefined,
                        reason: typeof obj.reason === "string" ? obj.reason : undefined,
                        code: typeof obj.code === "number" ? obj.code : undefined,
                        details: (obj.details as KubernetesStatus["details"]) ?? undefined
                    };
                }
                break;
            }
        }
    }
    return undefined;
}

/**
 * Strip the transport noise a Kubernetes client appends to its own message.
 *
 * Only ever applied to the fallback path — when no `Status` was found, the
 * message is all there is, and cutting it at the first header keeps the
 * sentence while dropping the `audit-id` and the flowschema uid nobody outside
 * the cluster can use.
 */
function trimTransportNoise(message: string): string {
    const cut = message.search(
        /\s*(?:headers:|HTTP request failed|audit-id|x-kubernetes-pf-|\{"kind":"Status")/i
    );
    const trimmed = (cut > 0 ? message.slice(0, cut) : message).trim();
    return trimmed.replace(/[\s:,-]+$/, "");
}

/** The longest a summary may be before it stops being one. */
const MAX_SUMMARY = 300;

/**
 * One actionable line (plus a hint) from whatever the control plane returned.
 *
 * `status` is the HTTP status of the control-plane call itself, which is a
 * different number from the `code` inside an embedded Kubernetes `Status` — the
 * control plane routinely answers 500 while the cluster answered 403, and it is
 * the inner one that says what happened.
 */
export function summarizeError(error: unknown, context: string): ErrorSummary {
    const err = error as { status?: number; message?: string; code?: string };
    const raw = err?.message ?? String(error);
    const k8s = extractKubernetesStatus(raw);

    if (k8s) {
        const inner = k8s.message?.trim() ?? "";
        const forbidden = k8s.code === 403 || k8s.reason === "Forbidden";
        const platform = forbidden && PLATFORM_PRINCIPAL_RE.test(inner);

        if (platform) {
            return {
                // Named as the platform's before the sentence that follows, so
                // the first thing read is whose problem it is.
                message: `${context}: the platform's own cluster credentials were refused by Kubernetes.`,
                hint:
                    `${truncate(inner)}\n`
                    + "  This is a platform-side permission, not something your project can grant. "
                    + "Nothing in your code, collections or deploy flags will change it — "
                    + "report it with the message above rather than retrying or changing the project.",
                code: "platform_permission_denied",
                platform: true,
                raw
            };
        }

        return {
            message: `${context}: ${truncate(inner || k8s.reason || "the cluster refused the request")}`,
            hint: k8s.code ? `Kubernetes answered ${k8s.code}${k8s.reason ? ` (${k8s.reason})` : ""}.` : undefined,
            code: k8s.reason ? `k8s_${k8s.reason.toLowerCase()}` : "k8s_error",
            platform: false,
            raw
        };
    }

    // Not a Kubernetes refusal. Still worth trimming: the same transport dumps
    // its headers onto plenty of errors that carry no `Status` at all.
    const trimmed = trimTransportNoise(raw);
    return {
        message: `${context}${err?.status ? ` (${err.status})` : ""}: ${truncate(trimmed || raw)}`,
        code: err?.code ?? (err?.status ? `http_${err.status}` : "request_failed"),
        platform: false,
        raw
    };
}

function truncate(text: string): string {
    const flat = text.replace(/\s+/g, " ").trim();
    return flat.length > MAX_SUMMARY ? `${flat.slice(0, MAX_SUMMARY - 1)}…` : flat;
}

/**
 * Whether the caller asked for the untouched body.
 *
 * `--debug` is already what `bin/rebase.js` prints after every failure as the
 * thing to add, so the raw payload hangs off the flag people are told to reach
 * for rather than off one invented here.
 */
export function wantsRawError(argv: readonly string[] = process.argv): boolean {
    return argv.includes("--debug") || process.env.REBASE_DEBUG === "1";
}
