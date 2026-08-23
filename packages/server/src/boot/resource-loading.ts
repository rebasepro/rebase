/**
 * Getting a bundle's resource declarations into the registry at boot.
 *
 * The graph could be read from the committed `rebase.resources.json`, and a
 * *host* does exactly that — it is the artifact that lets a console decide what
 * to provision without running anything. A running backend cannot, for one
 * reason: the file records that a subscription exists, and the backend needs
 * the *function*. Handlers only exist once the module declaring them has been
 * evaluated.
 *
 * So the runtime evaluates, and the file is for readers who do not. That the
 * two agree is what `rebase resources --check` gates.
 *
 * The config index is imported for its exports elsewhere, and re-exporting
 * `resources.ts` from it would be enough — but only if every project remembers
 * to. This imports it directly instead, so a project that forgets gets its
 * resources anyway rather than a backend that boots with none and says nothing.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { buildResourceGraph, type ResourceGraph } from "@rebasepro/types";
import { logger } from "../utils/logger.js";
import { resolveBundlePath, type LoadedBundle } from "./bundle.js";

/** Where a project's declarations live, relative to its config directory. */
const RESOURCE_ENTRIES = ["resources.js", "resources.ts", "resources/index.js", "resources/index.ts"];

/**
 * Evaluate a bundle's resource declarations and return the graph.
 *
 * A project with no `resources.ts` is normal and returns whatever the config
 * index already registered — which for most projects is nothing, and a single
 * default database is then synthesised downstream exactly as before.
 */
export async function loadBundleResourceGraph(bundle: LoadedBundle): Promise<ResourceGraph> {
    const configEntry = bundle.manifest.entry?.config;
    if (configEntry) {
        const configDir = resolveBundlePath(bundle.dir, configEntry, "config");
        const entry = RESOURCE_ENTRIES
            .map(name => path.join(configDir, name))
            .find(candidate => fs.existsSync(candidate));

        if (entry) {
            try {
                await import(pathToFileURL(entry).href);
            } catch (err) {
                // Fatal, unlike the config index, which warns and continues.
                // A config index that fails to import costs a project its
                // callbacks; a resources module that fails to import costs it
                // every database and bucket it declared, and the backend would
                // otherwise come up bound to nothing and report itself healthy.
                throw new Error(
                    `Could not load resource declarations from ${entry}: ` +
                    `${err instanceof Error ? err.message : String(err)}. ` +
                    "Refusing to boot: every database, bucket and topic this project declares " +
                    "lives in that module, and starting without them would answer requests " +
                    "against resources nobody bound."
                );
            }
        }
    }

    const graph = buildResourceGraph();
    if (graph.resources.length > 0) {
        logger.debug(
            `[resources] ${graph.resources.length} declared: ` +
            graph.resources.map(r => `${r.kind}:${r.key}`).join(", ")
        );
    }
    return graph;
}
