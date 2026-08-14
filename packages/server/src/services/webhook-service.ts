import { createHmac, randomUUID } from "crypto";
import { assertAllowedOutboundUrl, BlockedUrlError } from "./outbound-url-guard";
import { logger } from "../utils/logger";
import type { JobQueueClient } from "../jobs/types";

/**
 * The task name a queued webhook delivery is stored under.
 *
 * Namespaced, and frozen: it is written into `rebase.jobs` rows that outlive
 * the deploy that wrote them, so renaming it would strand every delivery
 * already queued under the old name until they dead-lettered.
 */
export const WEBHOOK_DELIVERY_TASK = "rebase.webhook.deliver";

export interface WebhookConfig {
    id: string;
    url: string;
    secret?: string;
    headers?: Record<string, string>;
    events: string[];
    table: string;
    enabled: boolean;
}

export interface WebhookDeliveryResult {
    webhookId: string;
    event: string;
    payload: Record<string, unknown>;
    statusCode: number;
    responseBody: string;
    success: boolean;
    attemptNumber: number;
}

export interface WebhookDispatcherOptions {
    /**
     * Deliver to destinations that resolve to loopback, link-local or private
     * addresses. Off by default. Turning it on re-opens SSRF: anyone who can
     * choose a webhook URL can then reach the pod's metadata endpoint, the
     * cluster API server and the database — and read the first 1000 bytes of
     * the answer back out of `responseBody`. Only for a receiver you run
     * yourself on the same host or network.
     */
    allowPrivateNetworks?: boolean;
    /**
     * Deadline for one attempt, covering the response body as well as the
     * headers. Defaults to 10s.
     */
    timeoutMs?: number;
    /**
     * Called with the final result of every delivery, including the ones
     * started by {@link WebhookDispatcher.enqueueEntityChange} — which return
     * nothing to their caller, so this is the only place their failures
     * surface.
     */
    onDelivery?: (result: WebhookDeliveryResult) => void;
    /**
     * Hostname resolver used by the destination guard. Defaults to
     * `dns.lookup`; injected by tests so a unit suite never asks a resolver.
     */
    lookup?: (hostname: string) => Promise<string[]>;
    /**
     * Where {@link WebhookDispatcher.enqueueEntityChange} puts deliveries.
     *
     * Without it they go to an in-memory array that a crash or a deploy
     * empties. With it they are rows, retried with backoff by a worker that
     * may not even be the process that queued them.
     */
    jobQueue?: JobQueueClient;
}

/**
 * A delivery attempt, plus whether another one could ever go differently.
 * A refused destination or a redirect fails the same way every time; sleeping
 * 6 seconds to prove it is 6 seconds of somebody's transaction.
 */
interface DeliveryAttempt {
    result: WebhookDeliveryResult;
    terminal: boolean;
}

interface QueuedDelivery {
    webhook: WebhookConfig;
    event: string;
    payload: Record<string, unknown>;
}

/** Read at most this much of a response before cancelling the rest. */
const MAX_RESPONSE_BYTES = 64 * 1024;

export class WebhookDispatcher {
    private webhooks: WebhookConfig[] = [];
    private maxRetries = 3;
    private retryDelays = [1000, 5000, 15000]; // Exponential backoff
    private readonly options: WebhookDispatcherOptions;
    private readonly timeoutMs: number;
    private queue: QueuedDelivery[] = [];
    private draining: Promise<void> | null = null;

    constructor(options: WebhookDispatcherOptions = {}) {
        this.options = options;
        this.timeoutMs = options.timeoutMs ?? 10000;
    }

    /** Register webhooks to watch */
    setWebhooks(webhooks: WebhookConfig[]): void {
        this.webhooks = webhooks.filter(w => w.enabled);
    }

    /**
     * Called when a entity changes — checks if any webhook matches, and awaits
     * every delivery, retries included.
     *
     * **Do not await this inside a collection callback.** `afterSave` and
     * `afterDelete` run inside the write's Postgres transaction, so awaiting a
     * delivery here holds a pooled connection and the row's locks for as long
     * as the receiver takes to answer — up to ~36s across three attempts, per
     * matching webhook. Use {@link enqueueEntityChange} there; this method is
     * for a custom function or a job that wants the results.
     */
    async onEntityChange(
        table: string,
        event: "INSERT" | "UPDATE" | "DELETE",
        id: string,
        entity: Record<string, unknown> | null,
        previousEntity?: Record<string, unknown> | null
    ): Promise<WebhookDeliveryResult[]> {
        const jobs = this.buildDeliveries(table, event, entity, previousEntity);

        const results: WebhookDeliveryResult[] = [];
        for (const job of jobs) {
            const result = await this.deliverWithRetry(job.webhook, job.event, job.payload);
            this.options.onDelivery?.(result);
            results.push(result);
        }

        return results;
    }

    /**
     * Queue the same deliveries and return immediately.
     *
     * This is the form a collection callback wants. `afterSave` is awaited
     * *inside* the transaction that wrote the row, so anything it awaits is
     * transaction time; queueing hands the HTTP to a drain loop that runs
     * after the callback returns, and the transaction commits without waiting
     * for a third party. It also means a receiver that is down can no longer
     * fail the customer's write.
     *
     * The cost, when no `jobQueue` is configured: the queue is in-process and
     * in-memory. A crash or a deploy between the enqueue and the delivery drops
     * the event, and a receiver may see the notification a few milliseconds
     * before the row it describes is committed. Use {@link flush} on shutdown,
     * and `onDelivery` to record failures.
     *
     * With `jobQueue` set, only the second half of that remains: the delivery
     * becomes a row in `rebase.jobs` and survives the crash, the deploy and the
     * pod being rescheduled.
     */
    enqueueEntityChange(
        table: string,
        event: "INSERT" | "UPDATE" | "DELETE",
        id: string,
        entity: Record<string, unknown> | null,
        previousEntity?: Record<string, unknown> | null
    ): void {
        const jobs = this.buildDeliveries(table, event, entity, previousEntity);
        if (jobs.length === 0) return;

        // The webhook is referenced by id rather than embedded. Its `secret`
        // would otherwise be written into `rebase.jobs` in cleartext and sit
        // there for as long as retention keeps the row — and a webhook edited
        // between the enqueue and the delivery should go out as it is now, not
        // as it was.
        if (this.options.jobQueue) {
            for (const job of jobs) {
                void this.options.jobQueue
                    .enqueue(WEBHOOK_DELIVERY_TASK, {
                        webhookId: job.webhook.id,
                        event: job.event,
                        payload: job.payload
                    })
                    .catch((error) => {
                        // The one case where the durable path is worse than the
                        // memory one, so it does not fail silently — and the
                        // delivery still goes out rather than being lost.
                        logger.error("[webhooks] Could not queue a delivery; falling back to in-process", { error });
                        this.queue.push(job);
                        this.startDraining();
                    });
            }
            return;
        }

        this.queue.push(...jobs);
        this.startDraining();
    }

    /**
     * Deliver one queued job, as the worker runs it.
     *
     * One attempt, and it throws on failure. The retries belong to the queue
     * now: keeping both would multiply — three in-process attempts inside each
     * of three job attempts is nine deliveries and about two minutes of holding
     * a worker slot — and only the queue's retries survive a restart, which is
     * the whole reason for moving.
     */
    async deliverQueuedJob(job: { webhookId: string; event: string; payload: Record<string, unknown> }): Promise<void> {
        const webhook = this.webhooks.find(w => w.id === job.webhookId);
        if (!webhook) {
            // Deleted or disabled between the enqueue and now. Not an error:
            // the operator's most recent instruction is that this endpoint
            // should not be called.
            logger.warn(`[webhooks] Dropping a queued delivery for unknown or disabled webhook "${job.webhookId}"`);
            return;
        }

        const { result, terminal } = await this.deliver(webhook, job.event, job.payload, 1);
        this.options.onDelivery?.(result);

        if (result.success) return;

        if (terminal) {
            // A refused destination or a redirect fails identically every time.
            // Retrying it costs three more worker slots to reach the same
            // answer, so it is dead-lettered on the spot — with the reason,
            // which is the part somebody will need.
            logger.error(
                `[webhooks] "${webhook.id}" failed permanently: ${result.responseBody.slice(0, 200)}`
            );
            return;
        }

        throw new Error(
            `Webhook "${webhook.id}" responded ${result.statusCode}: ${result.responseBody.slice(0, 200)}`
        );
    }

    /**
     * Wait for every queued delivery to finish. For graceful shutdown, and for
     * tests that need to observe what {@link enqueueEntityChange} sent.
     *
     * In-process deliveries only — with a `jobQueue` configured there is
     * nothing here to wait for, because the deliveries are rows.
     */
    async flush(): Promise<void> {
        while (this.draining) {
            await this.draining;
        }
    }

    private startDraining(): void {
        if (this.draining) return;
        const run = this.drainQueue().finally(() => {
            if (this.draining === run) this.draining = null;
        });
        this.draining = run;
    }

    private async drainQueue(): Promise<void> {
        while (this.queue.length > 0) {
            const job = this.queue.shift() as QueuedDelivery;
            try {
                const result = await this.deliverWithRetry(job.webhook, job.event, job.payload);
                this.options.onDelivery?.(result);
            } catch {
                // `deliverWithRetry` converts everything to a result, but a
                // throw from `onDelivery` must not take the queue down with it.
            }
        }
    }

    /** The payload each matching webhook gets for this change. */
    private buildDeliveries(
        table: string,
        event: "INSERT" | "UPDATE" | "DELETE",
        entity: Record<string, unknown> | null,
        previousEntity?: Record<string, unknown> | null
    ): QueuedDelivery[] {
        const matchingWebhooks = this.webhooks.filter(
            w => w.table === table && w.events.includes(event)
        );

        return matchingWebhooks.map(webhook => ({
            webhook,
            event,
            payload: {
                type: event,
                table,
                record: entity,
                old_record: event === "UPDATE" ? previousEntity : undefined,
                schema: "public",
                timestamp: new Date().toISOString()
            }
        }));
    }

    private async deliverWithRetry(
        webhook: WebhookConfig,
        event: string,
        payload: Record<string, unknown>
    ): Promise<WebhookDeliveryResult> {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            const { result, terminal } = await this.deliver(webhook, event, payload, attempt);
            if (result.success || terminal) return result;

            if (attempt < this.maxRetries) {
                // `maxRetries` and `retryDelays.length` have to agree, and
                // nothing makes them. Raising the first without extending the
                // second indexes past the end, and `setTimeout(r, undefined)`
                // is not a pause — it is an immediate retry, against an
                // endpoint that has just failed.
                const backoff = this.retryDelays[attempt - 1] ?? this.retryDelays[this.retryDelays.length - 1];
                await new Promise(r => setTimeout(r, backoff));
            } else {
                return result; // Final failure
            }
        }

        // Should never reach here, but satisfies TypeScript
        return {
            webhookId: webhook.id,
            event,
            payload,
            statusCode: 0,
            responseBody: "Max retries exceeded",
            success: false,
            attemptNumber: this.maxRetries
        };
    }

    private async deliver(
        webhook: WebhookConfig,
        event: string,
        payload: Record<string, unknown>,
        attemptNumber: number
    ): Promise<DeliveryAttempt> {
        const body = JSON.stringify(payload);

        const headers: Record<string, string> = {
            "Content-Type": "application/json",
            "X-Webhook-Id": webhook.id,
            "X-Webhook-Event": event,
            "X-Webhook-Delivery": randomUUID(),
            "X-Webhook-Attempt": String(attemptNumber),
            ...(webhook.headers || {})
        };

        // HMAC signature
        if (webhook.secret) {
            const signature = createHmac("sha256", webhook.secret).update(body).digest("hex");
            headers["X-Webhook-Signature"] = `sha256=${signature}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            // The destination is a string from a config, and configs are loaded
            // from environment *and* from databases. Validate it here rather
            // than trusting every caller to: unchecked, `fetch` will happily
            // POST to 169.254.169.254 and hand the response back through
            // `responseBody`.
            const url = await assertAllowedOutboundUrl(webhook.url, {
                allowPrivateNetworks: this.options.allowPrivateNetworks,
                lookup: this.options.lookup
            });

            const response = await fetch(url.href, {
                method: "POST",
                headers,
                body,
                signal: controller.signal,
                // Following a redirect would send this POST — signature, custom
                // headers and all — to an address the guard above never saw.
                // A webhook receiver has no reason to redirect.
                redirect: "manual"
            });

            if (response.status >= 300 && response.status < 400) {
                const location = typeof response.headers?.get === "function" ? response.headers.get("location") : null;
                return {
                    terminal: true,
                    result: {
                        webhookId: webhook.id,
                        event,
                        payload,
                        statusCode: response.status,
                        responseBody:
                            `Webhook receivers must not redirect: HTTP ${response.status}` +
                            (location ? ` to ${location}` : "") +
                            ". The redirect target is not re-validated, so it is not followed.",
                        success: false,
                        attemptNumber
                    }
                };
            }

            // Read the body under the *same* deadline as the request. Clearing
            // the timer before this read is what let a receiver that trickles
            // one byte a minute hang a delivery forever.
            const responseBody = await this.readCappedBody(response);
            const success = response.status >= 200 && response.status < 300;

            return {
                terminal: false,
                result: {
                    webhookId: webhook.id,
                    event,
                    payload,
                    statusCode: response.status,
                    responseBody: responseBody.slice(0, 1000), // Truncate
                    success,
                    attemptNumber
                }
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                // A refused destination is a decision, not an outage: the next
                // two attempts would refuse it identically.
                terminal: error instanceof BlockedUrlError,
                result: {
                    webhookId: webhook.id,
                    event,
                    payload,
                    statusCode: 0,
                    responseBody: message.slice(0, 1000),
                    success: false,
                    attemptNumber
                }
            };
        } finally {
            // `finally`, so an attempt that rejects fast (ECONNREFUSED, DNS)
            // does not leave a 10s timer armed on the event loop.
            clearTimeout(timeout);
        }
    }

    /**
     * Read at most {@link MAX_RESPONSE_BYTES} of the response and cancel the
     * rest, so a receiver cannot buffer a 10 GB body into the pod before the
     * caller truncates it to 1000 characters.
     */
    private async readCappedBody(response: Response): Promise<string> {
        const stream = response.body;
        if (!stream || typeof stream.getReader !== "function") {
            // A non-streaming Response — a test double, or a polyfilled fetch.
            // The abort signal is still armed, so a stalled body still fails;
            // only the size cap is unavailable here.
            return await response.text().catch(() => "");
        }

        const reader = stream.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                if (!value) continue;
                chunks.push(value);
                total += value.byteLength;
                if (total >= MAX_RESPONSE_BYTES) break;
            }
        } catch {
            // A body that fails or aborts part-way still describes the status.
            return new TextDecoder().decode(concat(chunks, total));
        } finally {
            await reader.cancel().catch(() => undefined);
        }

        return new TextDecoder().decode(concat(chunks, total));
    }
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        const room = out.length - offset;
        if (room <= 0) break;
        out.set(chunk.length > room ? chunk.subarray(0, room) : chunk, offset);
        offset += chunk.length;
    }
    return out;
}
