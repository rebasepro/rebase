/**
 * `rebase eject infra` — take ownership of where resources live.
 *
 * The other rung of the ladder, beside `rebase eject` itself. That one hands
 * over the *process*: the entrypoint and the Dockerfile the managed runtime was
 * running for you. This one hands over the *addresses*: the file the binder
 * consults before it looks at the environment.
 *
 * What it writes is deliberately not a blank template. It is the environment
 * path, spelled out — one entry per declared resource, each pointing at exactly
 * the variable the binder would have read. So the file changes nothing on the
 * day it is written, which is the property that makes an escape hatch
 * trustworthy: you get what was already running, and then you edit it.
 *
 * Secrets stay out. Every value is an `{"$env": "..."}` pointer rather than a
 * literal, because this file is the sort of thing that ends up in a config
 * repository, and a generator that inlined a password once would have taught
 * everyone that inlining is normal.
 */
import {
    envBasesForResource,
    resourceEnvSuffix,
    type ResourceGraph
} from "@rebasepro/types";

/** The infra config as written by an eject. */
export interface EjectedInfraConfig {
    version: 1;
    resources: Record<string, Record<string, { $env: string }>>;
}

/** `kind:key`, the identity shared with the graph and the runtime binder. */
function idOf(kind: string, key: string): string {
    return `${kind}:${key}`;
}

/**
 * Build the infra config for a graph.
 *
 * A kind with no `envBases` — one registered by a plugin that binds some other
 * way — still gets an entry, empty, rather than being dropped. An absent entry
 * reads as "this resource needs nothing"; an empty one reads as "this resource
 * needs something and I do not know what", which is the true statement.
 */
export function buildInfraConfig(graph: ResourceGraph): EjectedInfraConfig {
    const resources: EjectedInfraConfig["resources"] = {};

    for (const declaration of graph.resources) {
        const suffix = resourceEnvSuffix(declaration.key);
        const entry: Record<string, { $env: string }> = {};
        // Only the variables this engine actually uses. A `local` bucket does
        // not need an S3 endpoint, and writing one anyway produces a file whose
        // irrelevant keys train the reader to skim it.
        for (const base of envBasesForResource(declaration)) {
            entry[base] = { $env: `${base}${suffix}` };
        }
        resources[idOf(declaration.kind, declaration.key)] = entry;
    }

    return { version: 1, resources };
}

/** Serialised the way it is written: stable, four-space, trailing newline. */
export function serializeInfraConfig(config: EjectedInfraConfig): string {
    return JSON.stringify(config, null, 4) + "\n";
}

/**
 * What to tell somebody once it is written.
 *
 * Says the two things that are not obvious from looking at the file: that it
 * takes precedence over the environment, and that it changes nothing until
 * they edit it.
 */
export function describeEjectedInfra(config: EjectedInfraConfig, filename: string): string {
    const count = Object.keys(config.resources).length;
    return [
        `Wrote ${filename} with ${count} resource${count === 1 ? "" : "s"}.`,
        "",
        "  It is read BEFORE the environment, and every value points at the variable",
        "  the binder was already reading — so nothing changes until you edit it.",
        "",
        "  Replace an {\"$env\": \"...\"} pointer with a literal to pin a value here, or",
        "  point it at a different variable. Keep secrets as pointers.",
        ""
    ].join("\n");
}
