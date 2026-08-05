import { createHmac, randomUUID } from "crypto";

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

export class WebhookDispatcher {
    private webhooks: WebhookConfig[] = [];
    private maxRetries = 3;
    private retryDelays = [1000, 5000, 15000]; // Exponential backoff

    /** Register webhooks to watch */
    setWebhooks(webhooks: WebhookConfig[]): void {
        this.webhooks = webhooks.filter(w => w.enabled);
    }

    /** Called when a entity changes — checks if any webhook matches */
    async onEntityChange(
        table: string,
        event: "INSERT" | "UPDATE" | "DELETE",
        id: string,
        entity: Record<string, unknown> | null,
        previousEntity?: Record<string, unknown> | null
    ): Promise<WebhookDeliveryResult[]> {
        const matchingWebhooks = this.webhooks.filter(
            w => w.table === table && w.events.includes(event)
        );

        if (matchingWebhooks.length === 0) return [];

        const results: WebhookDeliveryResult[] = [];

        for (const webhook of matchingWebhooks) {
            const payload: Record<string, unknown> = {
                type: event,
                table,
                record: entity,
                old_record: event === "UPDATE" ? previousEntity : undefined,
                schema: "public",
                timestamp: new Date().toISOString()
            };

            const result = await this.deliverWithRetry(webhook, event, payload);
            results.push(result);
        }

        return results;
    }

    private async deliverWithRetry(
        webhook: WebhookConfig,
        event: string,
        payload: Record<string, unknown>
    ): Promise<WebhookDeliveryResult> {
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            const result = await this.deliver(webhook, event, payload, attempt);
            if (result.success) return result;

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
    ): Promise<WebhookDeliveryResult> {
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

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(webhook.url, {
                method: "POST",
                headers,
                body,
                signal: controller.signal
            });

            clearTimeout(timeout);

            const responseBody = await response.text().catch(() => "");
            const success = response.status >= 200 && response.status < 300;

            return {
                webhookId: webhook.id,
                event,
                payload,
                statusCode: response.status,
                responseBody: responseBody.slice(0, 1000), // Truncate
                success,
                attemptNumber
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                webhookId: webhook.id,
                event,
                payload,
                statusCode: 0,
                responseBody: message.slice(0, 1000),
                success: false,
                attemptNumber
            };
        }
    }
}
