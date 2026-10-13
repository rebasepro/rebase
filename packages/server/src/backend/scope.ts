/**
 * Which backend the code running right now is running for.
 *
 * A function file imports `rebase` from `@rebasepro/server/functions`; a topic
 * handle from `config/resources.ts` publishes with `signups.publish(event)`.
 * Neither names a backend — they are module-level values, written once and
 * shared by every backend in the process. So the backend serving a request
 * enters its scope for the rest of that request (and a cron run, and a job),
 * and those handles resolve through it: inside a request backend X answers,
 * `rebase` is X's client and a publish lands in X's queue. Outside every
 * scope they fall back to the process default, which `setDefaultBackend`
 * installs.
 *
 * The scope is an `AsyncLocalStorage`, which is why this module is host-side
 * and never reachable from `@rebasepro/server/functions`: the portable entry
 * reads the scope only through the resolver hook in `../singleton.ts`, which
 * needs nothing from Node.
 *
 * The one piece of process state here is the hook itself — installed the first
 * time any backend enters a scope or is made the default, never by
 * `createRebaseBackend` — and it holds no backend: it reads the async context.
 *
 * @module
 */
import { AsyncLocalStorage } from "node:async_hooks";
import {
    setQueueRuntime,
    setTopicRuntime,
    type QueueRuntime,
    type RebaseServerClient,
    type TopicRuntime
} from "@rebasepro/types";
import { _setRebaseResolver } from "../singleton";

/** What module-level handles reach for, on one backend's behalf. */
export interface BackendScope {
    /** The backend's in-process client — what `rebase` is inside its scope. */
    rebase: RebaseServerClient;
    /** How the backend publishes to its topics, when it declares any. */
    topics?: TopicRuntime;
    /** How the backend enqueues on its queues, when it declares any. */
    queues?: QueueRuntime;
}

const scope = new AsyncLocalStorage<BackendScope>();

/** The backend installed as the process default — what a publish outside every scope goes to. */
let defaultScope: BackendScope | undefined;

let hooksInstalled = false;

/**
 * Point the module-level handles at the async context: `rebase` through the
 * singleton's resolver hook, topics and queues through a runtime that asks the
 * scope first and the default backend second. Once per process.
 *
 * A resolver another host registered before this one is kept as the fallback,
 * so an isolate host's own per-request answer still holds outside our scopes.
 */
function installHooks(): void {
    if (hooksInstalled) return;
    hooksInstalled = true;
    const previous = _setRebaseResolver(() => scope.getStore()?.rebase ?? previous?.() ?? null);
    setTopicRuntime(scopedTopics);
    setQueueRuntime(scopedQueues);
}

const scopedTopics: TopicRuntime = {
    publish(topic, event) {
        const runtime = (scope.getStore() ?? defaultScope)?.topics;
        if (!runtime) {
            throw new Error(
                `Cannot publish to topic "${topic}": the backend running this code declares no topics, ` +
                "so it has no topic runtime. Declare the topic in config/resources.ts, which the backend reads when it is created."
            );
        }
        return runtime.publish(topic, event);
    }
};

const scopedQueues: QueueRuntime = {
    enqueue(queue, payload, options) {
        const runtime = (scope.getStore() ?? defaultScope)?.queues;
        if (!runtime) {
            throw new Error(
                `Cannot enqueue on queue "${queue}": the backend running this code declares no queues, ` +
                "so it has no queue runtime. Declare the queue in config/resources.ts, which the backend reads when it is created."
            );
        }
        return runtime.enqueue(queue, payload, options);
    }
};

/**
 * Run `fn` on a backend's behalf: inside it, and in everything it awaits,
 * `rebase` is `backend.rebase` and topics and queues publish through the
 * backend's own runtimes.
 */
export function runInBackendScope<T>(backend: BackendScope, fn: () => T): T {
    installHooks();
    return scope.run(backend, fn);
}

/** The backend the running code is scoped to, if any. */
export function currentBackendScope(): BackendScope | undefined {
    return scope.getStore();
}

/**
 * Make `backend` what topics and queues publish to outside every scope. Called
 * by `setDefaultBackend`, alongside the singleton slot it fills for `rebase`.
 */
export function setDefaultBackendScope(backend: BackendScope | undefined): void {
    installHooks();
    defaultScope = backend;
}
