import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "./types";

export interface LogEntry {
    id: string;
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    source: "api" | "auth" | "storage" | "realtime" | "system";
    message: string;
    metadata?: Record<string, unknown>;
}

class LogRingBuffer {
    private buffer: LogEntry[] = [];
    private maxSize: number;
    private idCounter = 0;

    constructor(maxSize = 10000) {
        this.maxSize = maxSize;
    }

    push(entry: Omit<LogEntry, "id">): void {
        const id = `log_${++this.idCounter}`;
        this.buffer.push({ ...entry,
id });
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    query(options: {
        level?: string;
        source?: string;
        search?: string;
        limit?: number;
        offset?: number;
        since?: string;
    }): { entries: LogEntry[]; total: number } {
        let filtered = this.buffer;

        if (options.level) {
            filtered = filtered.filter(e => e.level === options.level);
        }
        if (options.source) {
            filtered = filtered.filter(e => e.source === options.source);
        }
        if (options.search) {
            const searchLower = options.search.toLowerCase();
            filtered = filtered.filter(e => e.message.toLowerCase().includes(searchLower));
        }
        if (options.since) {
            const sinceValue = options.since;
            filtered = filtered.filter(e => e.timestamp >= sinceValue);
        }

        // Newest first
        const sorted = [...filtered].reverse();
        const total = sorted.length;
        const limit = options.limit || 100;
        const offset = options.offset || 0;

        return {
            entries: sorted.slice(offset, offset + limit),
            total
        };
    }

    getLatest(count = 50): LogEntry[] {
        return this.buffer.slice(-count).reverse();
    }
}

// Global singleton
export const logBuffer = new LogRingBuffer();

/** Add a log entry */
export function addLog(
    level: LogEntry["level"],
    source: LogEntry["source"],
    message: string,
    metadata?: Record<string, unknown>
): void {
    logBuffer.push({
        timestamp: new Date().toISOString(),
        level,
        source,
        message,
        metadata
    });
}

/** Hono middleware to log API requests */
export function logMiddleware(): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        const start = Date.now();
        await next();
        const duration = Date.now() - start;
        const reqId = c.get("requestId");
        addLog("info", "api", `${c.req.method} ${c.req.path} ${c.res.status} ${duration}ms`, {
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
            duration,
            ...(reqId && { requestId: reqId })
        });
    };
}

const app = new Hono<HonoEnv>();

// GET /api/logs — Query logs
app.get("/", (c) => {
    const query = c.req.query();
    const result = logBuffer.query({
        level: query.level,
        source: query.source,
        search: query.search,
        limit: query.limit ? parseInt(query.limit) : undefined,
        offset: query.offset ? parseInt(query.offset) : undefined,
        since: query.since
    });
    return c.json(result);
});

// GET /api/logs/latest — Get latest logs (for real-time)
app.get("/latest", (c) => {
    const count = parseInt(c.req.query("count") || "50");
    return c.json({ entries: logBuffer.getLatest(count) });
});

export default app;
