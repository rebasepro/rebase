/**
 * Queues, on the durable job queue.
 *
 * A queue is the other shape of background work: one consumer, work items
 * rather than events. Topics fan out — one row per subscription — because
 * several things react to one event and each must retry alone. A queue has
 * exactly one handler, so a job is one row, and the thing a caller holds is
 * that row's id.
 *
 * Same substrate as topics and the same guarantees: at-least-once (a worker
 * that dies holding a job releases it after the visibility timeout, and the
 * next one starts the handler from the top), transactional enqueue (a row
 * insert, gone with the transaction that rolls back), and kept-when-failed.
 *
 * ## Why this exists beside `jobs.tasks`
 *
 * `initializeRebaseBackend({ jobs: { tasks } })` has always been the way to
 * register a job handler — and it is only reachable from an entrypoint a
 * project writes itself. A project on the managed runtime has no entrypoint:
 * the platform boots the bundle, and there was no way to hand it a task. So the
 * durable queue existed and could not be used by the projects most likely to
 * need it. A queue declared in `config/resources.ts` is picked up by every boot
 * path, because the declaration is what boot reads.
 */
import {
    declaredQueueConsumers,
    setQueueRuntime,
    type QueueRuntime,
    type ResourceDeclaration
} from "@rebasepro/types";
import type { QueueEnqueueOptions } from "@rebasepro/types";
import type { JobHandler, JobQueueClient } from "../jobs/types.js";

/** The job task name a queue's jobs are recorded under. */
export function queueTaskName(queue: string): string {
    return `queue:${queue}`;
}

/** Attempts a queued job gets before it is left failed. */
export const DEFAULT_QUEUE_ATTEMPTS = 5;

/**
 * Build the job handlers every declared queue needs.
 *
 * Returned rather than registered, for the same reason as topics: the queue
 * takes its whole task map at construction, and a map assembled in one place
 * is one somebody can print.
 */
export function queueJobHandlers(): Record<string, JobHandler<never>> {
    const tasks: Record<string, JobHandler<never>> = {};
    for (const consumer of declaredQueueConsumers()) {
        tasks[queueTaskName(consumer.queue)] = (async (ctx: { id: string; payload: unknown; attempt: number }) => {
            await consumer.handler(ctx.payload, {
                attempt: ctx.attempt,
                queue: consumer.queue,
                jobId: ctx.id
            });
        }) as unknown as JobHandler<never>;
    }
    return tasks;
}

export interface QueueRuntimeOptions {
    queue: JobQueueClient;
    /** Declared queues, so enqueueing on an undeclared one can be refused. */
    queues: ResourceDeclaration[];
}

/**
 * Build the runtime queues enqueue through.
 *
 * Enqueueing on a queue nothing declared throws — a string name from an
 * ejected project or a dynamic caller can reach this, and rows under a task
 * no worker handles are rows nobody ever runs. A queue with no handler is
 * also refused, at enqueue rather than at boot: declaring a queue in one
 * place and its handler in another is an ordinary intermediate state while
 * someone builds the other half, but a job written into it would sit forever.
 */
export function createQueueRuntime(options: QueueRuntimeOptions): QueueRuntime {
    const { queue, queues } = options;
    const declared = new Map(queues.map(q => [q.key, q]));

    return {
        async enqueue(name: string, payload: unknown, enqueueOptions: QueueEnqueueOptions = {}): Promise<{ id: string }> {
            const declaration = declared.get(name);
            if (!declaration) {
                const known = [...declared.keys()].sort().join(", ") || "none";
                throw new Error(
                    `Cannot enqueue on queue "${name}": nothing declares it. Declared queues: ${known}. ` +
                    "Writing the row anyway would leave a job no worker handles."
                );
            }
            if (!declaredQueueConsumers().some(c => c.queue === name)) {
                throw new Error(
                    `Queue "${name}" has no handler. Declare one with ${name}.handler(async (payload) => { … }) ` +
                    "before enqueueing — a job written into a queue nothing consumes sits forever."
                );
            }

            const queueAttempts = typeof declaration.options.maxAttempts === "number"
                ? declaration.options.maxAttempts
                : undefined;
            const delayMs = enqueueOptions.runAt
                ? Math.max(0, enqueueOptions.runAt.getTime() - Date.now())
                : undefined;

            const id = await queue.enqueue(queueTaskName(name), payload, {
                maxAttempts: enqueueOptions.maxAttempts ?? queueAttempts ?? DEFAULT_QUEUE_ATTEMPTS,
                ...(delayMs !== undefined ? { delayMs } : {})
            });
            // The job store returns null only for an idempotency-key match,
            // and queues pass none — so a null here is a contract break, not
            // a duplicate, and it must not be handed back as an id.
            if (id === null) {
                throw new Error(`Queue "${name}" did not record the job. This is a bug in the job store.`);
            }
            return { id };
        }
    };
}

/** Install the runtime, and hand back a teardown. */
export function installQueueRuntime(options: QueueRuntimeOptions): () => void {
    setQueueRuntime(createQueueRuntime(options));
    return () => setQueueRuntime(null);
}
