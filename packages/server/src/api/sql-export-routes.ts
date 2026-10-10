import { Hono } from "hono";
import { isSQLAdmin, type DatabaseAdmin, type SqlCursor } from "@rebasepro/types";
import { redactSqlLiterals } from "@rebasepro/common";
import { csvRecord } from "@rebasepro/utils";
import { ApiError } from "./errors";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";

/**
 * The SQL console's "Download full result as CSV".
 *
 * The console shows at most the first 10,000 rows of a result (see
 * `SQL_CONSOLE_RESULT_LIMITS`), and its own export writes the rows on screen.
 * This route is the way to the rest: it runs ONE query through
 * `SQLAdmin.openSqlCursor` — a server-side cursor in a read-only transaction,
 * as the role the console picked — and streams it as RFC 4180 CSV, one batch
 * at a time. A batch is fetched only when the response has taken the last
 * one, so the server holds one batch however long the result is.
 *
 * Mounted under `/api/admin/sql` behind the admin gate with `database:write` —
 * the scope the socket's `EXECUTE_SQL` asks of the same console, so whoever
 * can run the query can download it and nobody else.
 */

/** RFC 4180's record separator. */
const CRLF = "\r\n";

export interface SqlExportRoutesOptions {
    /** The default data source's admin capabilities, read per request. */
    getAdmin: () => DatabaseAdmin | undefined;
}

interface ExportRequest {
    sql: string;
    database?: string;
    role?: string;
}

function readExportRequest(body: unknown): ExportRequest {
    if (typeof body !== "object" || body === null || !("sql" in body) || typeof body.sql !== "string" || body.sql.trim() === "") {
        throw ApiError.badRequest("Send the query to download as `sql`, a non-empty string.", "INVALID_INPUT");
    }
    const optional = (key: "database" | "role"): string | undefined => {
        const value: unknown = key in body ? Reflect.get(body, key) : undefined;
        if (value === undefined || value === null || value === "") return undefined;
        if (typeof value !== "string") throw ApiError.badRequest(`\`${key}\` must be a string.`, "INVALID_INPUT");
        return value;
    };
    return { sql: body.sql, database: optional("database"), role: optional("role") };
}

/**
 * The cursor's rows as CSV, a header record first. Read one batch per pull:
 * the stream asks for the next only when the response has taken this one.
 *
 * A failure after the first byte cannot change the status any more, so the
 * stream is errored instead — the download fails rather than ending early
 * with a file that looks whole.
 */
function csvStream(cursor: SqlCursor, onFailure: (error: unknown) => void): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let headerSent = false;
    return new ReadableStream<Uint8Array>({
        async pull(controller) {
            try {
                if (!headerSent) {
                    headerSent = true;
                    controller.enqueue(encoder.encode(csvRecord(cursor.columns) + CRLF));
                    return;
                }
                const rows = await cursor.read();
                if (!rows) {
                    await cursor.close();
                    controller.close();
                    return;
                }
                controller.enqueue(encoder.encode(rows.map(row => csvRecord(row) + CRLF).join("")));
            } catch (error: unknown) {
                onFailure(error);
                await cursor.close();
                controller.error(error);
            }
        },
        async cancel() {
            // The reader went away: end the read and give the session back.
            await cursor.close();
        }
    }, { highWaterMark: 1 });
}

export function createSqlExportRoutes(options: SqlExportRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    router.post("/csv", async (c) => {
        const request = readExportRequest(await c.req.json());
        const admin = options.getAdmin();
        if (!isSQLAdmin(admin) || typeof admin.openSqlCursor !== "function") {
            throw new ApiError(501, "SQL_EXPORT_UNSUPPORTED",
                "This data source cannot stream a query's result. Add a LIMIT and export the rows on screen.");
        }

        const caller = c.get("user");
        const user = typeof caller === "object" && caller !== null ? caller : undefined;
        const audit = {
            // Literals masked, as on the socket: a statement's shape is the
            // audit signal, its values are whatever the operator was reading.
            sql: redactSqlLiterals(request.sql).substring(0, 500),
            database: request.database,
            role: request.role,
            uid: user?.uid ?? "unknown",
            roles: user?.roles ?? [],
            ...(c.get("apiKey") ? { apiKey: c.get("apiKey")?.id } : {}),
            requestId: c.get("requestId")
        };

        // Opened before the response starts: a query the database refuses — a
        // write, a second statement, a syntax error — is a 400 with its
        // reason, not an empty file.
        const cursor = await admin.openSqlCursor(request.sql, { database: request.database, role: request.role });
        logger.info("[SQL Audit] SQL console CSV download", audit);

        const body = csvStream(cursor, (error) => logger.warn("[SQL export] The download failed part-way and was cut off", {
            requestId: audit.requestId,
            error: error instanceof Error ? error.message : String(error)
        }));
        return new Response(body, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": "attachment; filename=\"query_results.csv\"",
                "Cache-Control": "no-store"
            }
        });
    });

    return router;
}
