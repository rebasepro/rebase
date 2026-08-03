import fs from "fs";
import path from "path";

import { findProjectRoot, MANIFEST_FILENAME } from "../utils/project";

/**
 * A repository's own policy on usage sharing.
 *
 * ## Why this is deliberately one-directional
 *
 * `rebase.json` is committed, so whatever it says applies to everyone who
 * clones the repository — including people who have never seen our prompt. That
 * makes it the right place for exactly one of the two answers:
 *
 *  - **`false` is honoured**, and beats an individual's opt-in. An organisation
 *    restricting its own repository is setting policy for work done on its
 *    behalf, which is theirs to set. It is the same shape as a committed
 *    `.npmrc`.
 *  - **`true` is ignored**, and says so. It would be one developer answering a
 *    privacy question for every colleague who later clones the repo — consent
 *    by proxy, which is the precise thing opt-in exists to prevent.
 *
 * The asymmetry is the whole feature. A symmetric flag would be a worse version
 * of the machine-level setting, and a quietly-obeyed `true` would be a way to
 * enrol people without asking them.
 *
 * Read straight from the file rather than through `parseManifest`, for two
 * reasons: the parser builds a typed object and drops keys it does not model,
 * and a manifest too malformed to parse must still be able to switch telemetry
 * off. A repository that says no should be obeyed even when it is broken.
 */
export type ProjectTelemetryPolicy =
    /** `"telemetry": false` — suppress, regardless of the machine setting. */
    | "opt_out"
    /** `"telemetry": true` — refused; the machine setting still decides. */
    | "ignored_opt_in"
    /** No manifest, no key, or an unreadable one. */
    | "unset";

export function readProjectPolicy(startDir: string = process.cwd()): ProjectTelemetryPolicy {
    try {
        const root = findProjectRoot(startDir);
        if (!root) return "unset";

        const file = path.join(root, MANIFEST_FILENAME);
        if (!fs.existsSync(file)) return "unset";

        // A regex rather than JSON.parse: a manifest with a trailing comma or a
        // half-finished edit still parses badly but reads clearly, and "your
        // JSON is malformed" is not a reason to start sending data the file
        // plainly asks us not to send.
        const raw = fs.readFileSync(file, "utf-8");
        const match = /"telemetry"\s*:\s*(true|false)/.exec(raw);
        if (!match) return "unset";
        return match[1] === "false" ? "opt_out" : "ignored_opt_in";
    } catch {
        return "unset";
    }
}
