import { RebaseApiError, type SchemaAPI, type SchemaTablesOptions, type TableDescriptor } from "@rebasepro/types";
import type { ResponseMeta, Transport } from "./transport";

/**
 * The code `client.schema.tables()` rejects with when the backend serves no
 * tables: auth is not configured there (the route answers `404` with this
 * code), or the server predates the route (a bare `404`).
 *
 * @group Schema
 */
export const SCHEMA_UNAVAILABLE = "SCHEMA_UNAVAILABLE";

/**
 * Whether an error from `client.schema.tables()` says the backend serves no
 * tables at all — as opposed to refusing this caller or failing.
 *
 * @group Schema
 */
export function isSchemaUnavailable(error: unknown): boolean {
    return error instanceof RebaseApiError && error.code === SCHEMA_UNAVAILABLE;
}

/** The path of the route, under the API base path. */
const TABLES_PATH = "/schema/tables";

function isTableDescriptor(value: unknown): value is TableDescriptor {
    return typeof value === "object" && value !== null
        && "slug" in value && typeof value.slug === "string"
        && "columns" in value && Array.isArray(value.columns);
}

/**
 * `client.schema`: the backend's tables as `GET /api/schema/tables` serves
 * them to the signed-in caller.
 *
 * The answer is redacted per caller and the server tags it with an `ETag`;
 * the last answer is kept with its tag and the next request sends the tag in
 * `If-None-Match`, so an unchanged schema costs a `304` and no body. A `304`
 * says the answer for *this* caller still has the tag that was sent, so the
 * kept tables are exactly what the server would have sent — whoever is signed
 * in now.
 */
export function createSchema(transport: Transport): SchemaAPI {
    let last: { etag: string; tables: TableDescriptor[] } | undefined;

    async function tables(options?: SchemaTablesOptions): Promise<TableDescriptor[]> {
        const cached = last;
        const meta: ResponseMeta = {};
        let body: unknown;
        try {
            body = await transport.request<unknown>(TABLES_PATH, {
                method: "GET",
                ...(cached ? { headers: { "If-None-Match": cached.etag } } : {}),
                ...(options?.signal ? { signal: options.signal } : {})
            }, meta);
        } catch (error) {
            if (!(error instanceof RebaseApiError)) throw error;
            // `fetch` hands a 304 to the caller that sent `If-None-Match`
            // itself, and the transport reads every status outside 2xx as a
            // failure.
            if (error.status === 304 && cached) return cached.tables;
            if (error.status === 404 && error.code !== SCHEMA_UNAVAILABLE) {
                throw new RebaseApiError(
                    `This backend does not serve its tables (GET ${transport.apiPath}${TABLES_PATH} answered 404): it predates the route. ` +
                    "Upgrade @rebasepro/server, or pass the collections to <RebaseCMS collections> yourself.",
                    {
                        status: 404,
                        code: SCHEMA_UNAVAILABLE,
                        ...(error.requestId ? { requestId: error.requestId } : {}),
                        cause: error
                    }
                );
            }
            throw error;
        }

        if (!Array.isArray(body) || !body.every(isTableDescriptor)) {
            throw new RebaseApiError(
                `GET ${transport.apiPath}${TABLES_PATH} answered something other than a list of tables. ` +
                "Check that the client's baseUrl points at the Rebase backend.",
                { status: meta.status, code: "INVALID_RESPONSE" }
            );
        }
        last = meta.etag ? { etag: meta.etag, tables: body } : undefined;
        return body;
    }

    return { tables };
}
