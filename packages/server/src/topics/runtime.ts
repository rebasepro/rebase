/**
 * Topics, on the durable job queue.
 *
 * ## Why fan out at publish time
 *
 * Publishing writes **one job row per subscription**, not one row for the
 * event. That is the shape SNS→SQS has and the reason is the same: each
 * subscriber then retries on its own schedule, and a subscription that is
 * broken or slow neither blocks the others nor causes them to run again. A
 * single row per event forces one retry policy across every consumer, so the
 * fourth attempt of a failing audit log re-delivers a welcome email that
 * already went out.
 *
 * It also makes "did this subscriber get it" a row somebody can look at, which
 * is the property the job queue was built for: work that gives up is *kept*,
 * because a queue that silently drops what it could not deliver is
 * indistinguishable from one with nothing to do.
 *
 * ## What at-least-once means here
 *
 * A handler can see the same event twice — a worker that dies holding a job
 * releases it after the visibility timeout, and the next worker starts the
 * handler again from the top. Handlers must tolerate that. It is the honest
 * name for what a retrying queue does, which is why `at-most-once` is refused
 * at declaration rather than quietly given the other guarantee.
 *
 * ## Transactional publish
 *
 * `enqueue` is a row insert, so a publish inside a transaction that rolls back
 * was never published — the difference between "email sent for an order that
 * does not exist" and nothing having happened at all.
 */
import {
    declaredSubscriptions,
    setTopicRuntime,
    type ResourceDeclaration,
    type TopicRuntime
} from "@rebasepro/types";
import { logger } from "../utils/logger.js";
import type { JobHandler, JobQueueClient } from "./../jobs/types.js";

/** The job task name a subscription's deliveries are recorded under. */
export function topicTaskName(topic: string, subscription: string): string {
    return `topic:${topic}:${subscription}`;
}

/** Attempts a subscription gets before its delivery is left failed. */
export const DEFAULT_TOPIC_ATTEMPTS = 5;

/**
 * Build the job handlers every declared subscription needs.
 *
 * Returned rather than registered, because the queue takes its whole task map
 * at construction — and a task map assembled in one place is one somebody can
 * print.
 */
export function topicJobHandlers(): Record<string, JobHandler<never>> {
    const tasks: Record<string, JobHandler<never>> = {};
    for (const sub of declaredSubscriptions()) {
        const task = topicTaskName(sub.topic, sub.name);
        tasks[task] = (async (ctx: { payload: unknown; attempt: number }) => {
            await sub.handler(ctx.payload, {
                attempt: ctx.attempt,
                topic: sub.topic,
                subscription: sub.name
            });
        }) as unknown as JobHandler<never>;
    }
    return tasks;
}

/**
 * Topics warned about having no subscriber.
 *
 * Once per topic rather than per event: a topic nobody subscribes to is a
 * legitimate intermediate state while somebody builds the other half, but "I
 * published and nothing happened" is expensive to debug in silence, and a
 * per-event warning would bury the real log under a loop.
 */
const warnedEmpty = new Set<string>();

export interface TopicRuntimeOptions {
    queue: JobQueueClient;
    /** Declared topics, so publishing to an undeclared one can be refused. */
    topics: ResourceDeclaration[];
}

/**
 * Build the runtime topics publish through.
 *
 * Publishing to a topic nothing declared throws. The handle API makes it hard
 * to reach, but a string name from an ejected project or a dynamic caller can —
 * and enqueueing under a task no worker handles would write rows nobody ever
 * runs.
 */
export function createTopicRuntime(options: TopicRuntimeOptions): TopicRuntime {
    const { queue, topics } = options;
    const declared = new Map(topics.map(t => [t.key, t]));

    return {
        async publish(topic: string, event: unknown): Promise<void> {
            const declaration = declared.get(topic);
            if (!declaration) {
                const known = [...declared.keys()].sort().join(", ") || "none";
                throw new Error(
                    `Cannot publish to topic "${topic}": nothing declares it. Declared topics: ${known}. ` +
                    "Enqueueing it anyway would write rows no worker handles."
                );
            }

            const subs = declaredSubscriptions(topic);
            if (subs.length === 0) {
                if (!warnedEmpty.has(topic)) {
                    warnedEmpty.add(topic);
                    logger.warn(
                        `[topics] Published to "${topic}", which has no subscriptions — the event is dropped. ` +
                        "Declare one with topic.subscription(name, handler)."
                    );
                }
                return;
            }

            const topicAttempts = typeof declaration.options.maxAttempts === "number"
                ? declaration.options.maxAttempts
                : undefined;

            // Sequential rather than concurrent, so a publish inside a
            // transaction keeps every insert on that transaction's connection.
            for (const sub of subs) {
                await queue.enqueue(
                    topicTaskName(topic, sub.name),
                    event,
                    { maxAttempts: sub.maxAttempts ?? topicAttempts ?? DEFAULT_TOPIC_ATTEMPTS }
                );
            }
        }
    };
}

/**
 * Install the runtime, and hand back a teardown.
 *
 * Publishing without one throws rather than resolving — an event that
 * disappears into a resolved promise is the failure a queue exists to
 * prevent — so it is installed for exactly as long as a backend is up.
 */
export function installTopicRuntime(options: TopicRuntimeOptions): () => void {
    setTopicRuntime(createTopicRuntime(options));
    return () => {
        setTopicRuntime(null);
        warnedEmpty.clear();
    };
}
