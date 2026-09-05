/**
 * The graph, expressed as the shapes the existing subsystems already take.
 *
 * The data layer consumes `DataSourceDefinition[]` and the storage layer
 * consumes `StorageSourceDefinition[]`, and both work. Nothing about the
 * resource graph requires rewriting them: the graph is a better *declaration*,
 * not a different runtime. So it is translated at the boundary, once, and
 * everything downstream is untouched.
 *
 * Doing it the other way round — teaching each subsystem to read the graph —
 * would have meant touching the pool manager, the storage registry and the
 * collection resolver to land a config change, which is how a config change
 * becomes a rewrite and then does not ship.
 */
import {
    resourceToDataSource,
    resourceToStorageSource,
    type DataSourceDefinition,
    type ResourceGraph,
    type StorageSourceDefinition
} from "@rebasepro/types";

/**
 * Databases in the graph, as the data layer's definitions.
 *
 * The per-field mapping lives in `@rebasepro/types` next to the constructors,
 * so this and `declaredDataSources()` cannot answer differently. They used to:
 * this side carried a bucket's `account` and the types side dropped it, which
 * meant shared credentials resolved on the managed runtime and resolved nothing
 * in an ejected backend.
 */
export function graphToDataSources(graph: ResourceGraph): DataSourceDefinition[] {
    return graph.resources.filter(r => r.kind === "database").map(resourceToDataSource);
}

/** Buckets in the graph, as the storage layer's definitions. */
export function graphToStorageSources(graph: ResourceGraph): StorageSourceDefinition[] {
    return graph.resources.filter(r => r.kind === "bucket").map(resourceToStorageSource);
}

/** Topics in the graph, for the runtime to publish through and the worker to wire. */
export function graphTopics(graph: ResourceGraph): ResourceGraph["resources"] {
    return graph.resources.filter(r => r.kind === "topic");
}

/** Queues in the graph, for the runtime to enqueue on and the worker to wire. */
export function graphQueues(graph: ResourceGraph): ResourceGraph["resources"] {
    return graph.resources.filter(r => r.kind === "queue");
}

/**
 * Configuration keys the resource graph replaced.
 *
 * Each was a way to declare a resource somewhere other than a declaration, and
 * every one of them is gone. There is no compatibility mode: a config still
 * carrying one is refused at boot, by name, with the replacement in the
 * message.
 *
 * Silence here would be the exact failure this model was built to remove. The
 * old storage path accepted a `storageSources` export, merged it with
 * `rebase.json`, and discarded whichever engine lost — a declaration accepted
 * and then ignored. Leaving the key readable but inert would reproduce that
 * with better intentions.
 */
const REPLACED_CONFIG_KEYS: Record<string, string> = {
    dataSources:
        'declare each one with database("<key>") in your config\'s resources.ts, ' +
        "then run `rebase resources --write`",
    storageSources:
        'declare each one with bucket("<key>") in your config\'s resources.ts, ' +
        "then run `rebase resources --write`"
};

/**
 * Refuse a config still carrying a replaced key.
 *
 * Throws on the first one rather than collecting: unlike a manifest, where a
 * reader wants every problem at once, this is a single edit per key and the
 * message is long enough that three of them would bury each other.
 */
export function assertNoReplacedResourceConfig(config: Record<string, unknown>): void {
    for (const [key, remedy] of Object.entries(REPLACED_CONFIG_KEYS)) {
        if (config[key] === undefined) continue;
        throw new Error(
            `\`${key}\` is no longer read. Resources are declared in config code now, so that ` +
            `there is one place to look and nothing to merge.\n\n  To migrate: ${remedy}.\n\n` +
            "Refused rather than ignored: a key that is accepted and then does nothing is the " +
            "failure this replaced."
        );
    }
}

/** The keys this refuses, for a doctor check and for the tests that pin them. */
export function replacedResourceConfigKeys(): string[] {
    return Object.keys(REPLACED_CONFIG_KEYS);
}
