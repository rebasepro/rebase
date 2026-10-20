import { Hono } from "hono";
import { isBranchAdmin, type BranchDiffOptions, type BranchMergeOptions, type DatabaseAdmin } from "@rebasepro/types";
import { ApiError } from "./errors";
import type { HonoEnv } from "./types";
import { logger } from "../utils/logger";

/**
 * Studio's review of a database branch: what it changed, and merging it.
 *
 * Mounted under `/api/admin/branches` behind the admin gate — `database:read`
 * for the diff, `database:write` for the merge, the scopes the socket's
 * `LIST_BRANCHES` and `CREATE_BRANCH` ask of the same pane.
 *
 * Engine-agnostic: the comparison is the driver's (`BranchAdmin.diffBranch`,
 * `mergeBranch`), and a driver without it answers 501. The driver's refusals
 * are `ApiError`s that carry their own status — 404 for a branch that is not
 * there, 409 for a diff that went stale or a merge that would conflict.
 *
 * ```
 * GET  /:name/diff?sampleLimit=100&schemas=public,app&maxRowsPerTable=100000
 * POST /:name/merge   { expectedFingerprint, onConflict?, skipBlocked?, schemas?, maxRowsPerTable? }
 * ```
 */
export interface BranchRoutesOptions {
    /** The default data source's admin capabilities, read per request. */
    getAdmin: () => DatabaseAdmin | undefined;
}

function optionalInteger(value: string | undefined, name: string): number | undefined {
    if (value === undefined || value === "") return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw ApiError.badRequest(`\`${name}\` must be a non-negative integer.`, "INVALID_INPUT");
    }
    return parsed;
}

function schemaList(value: unknown): string[] | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    const list = typeof value === "string" ? value.split(",") : value;
    if (!Array.isArray(list) || !list.every((item) => typeof item === "string")) {
        throw ApiError.badRequest("`schemas` must be a list of schema names.", "INVALID_INPUT");
    }
    const names = list.map((item: string) => item.trim()).filter((item) => item !== "");
    return names.length > 0 ? names : undefined;
}

function readMergeRequest(body: unknown): BranchMergeOptions {
    if (typeof body !== "object" || body === null || !("expectedFingerprint" in body)
        || typeof body.expectedFingerprint !== "string" || body.expectedFingerprint === "") {
        throw ApiError.badRequest(
            "Send `expectedFingerprint`, the `fingerprint` of the diff that was reviewed.",
            "INVALID_INPUT"
        );
    }
    const field = (key: string): unknown => key in body ? Reflect.get(body, key) : undefined;
    const onConflict = field("onConflict");
    if (onConflict !== undefined && onConflict !== "abort" && onConflict !== "branch" && onConflict !== "target") {
        throw ApiError.badRequest("`onConflict` must be \"abort\", \"branch\" or \"target\".", "INVALID_INPUT");
    }
    const skipBlocked = field("skipBlocked");
    if (skipBlocked !== undefined && typeof skipBlocked !== "boolean") {
        throw ApiError.badRequest("`skipBlocked` must be a boolean.", "INVALID_INPUT");
    }
    const maxRows = field("maxRowsPerTable");
    if (maxRows !== undefined && (typeof maxRows !== "number" || !Number.isInteger(maxRows) || maxRows < 1)) {
        throw ApiError.badRequest("`maxRowsPerTable` must be a positive integer.", "INVALID_INPUT");
    }
    return {
        expectedFingerprint: body.expectedFingerprint,
        onConflict,
        skipBlocked,
        schemas: schemaList(field("schemas")),
        maxRowsPerTable: maxRows
    };
}

export function createBranchRoutes(options: BranchRoutesOptions): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();

    const branchAdmin = () => {
        const admin = options.getAdmin();
        if (!isBranchAdmin(admin) || typeof admin.diffBranch !== "function" || typeof admin.mergeBranch !== "function") {
            throw new ApiError(501, "BRANCH_DIFF_UNSUPPORTED",
                "This data source cannot compare branches. Branching needs a Postgres backend with an admin connection.");
        }
        return { diffBranch: admin.diffBranch.bind(admin), mergeBranch: admin.mergeBranch.bind(admin) };
    };

    router.get("/:name/diff", async (c) => {
        const { diffBranch } = branchAdmin();
        const diffOptions: BranchDiffOptions = {
            sampleLimit: optionalInteger(c.req.query("sampleLimit"), "sampleLimit"),
            maxRowsPerTable: optionalInteger(c.req.query("maxRowsPerTable"), "maxRowsPerTable"),
            schemas: schemaList(c.req.query("schemas"))
        };
        return c.json(await diffBranch(c.req.param("name"), diffOptions));
    });

    router.post("/:name/merge", async (c) => {
        const { mergeBranch } = branchAdmin();
        const name = c.req.param("name");
        const request = readMergeRequest(await c.req.json().catch(() => null));
        const caller = c.get("user");
        const user = typeof caller === "object" && caller !== null ? caller : undefined;
        const result = await mergeBranch(name, request);
        // Writes to the main database on someone's say-so: the audit line is
        // the record of whose.
        logger.info("[Branch Audit] Branch merged", {
            branch: name,
            target: result.targetDatabase,
            tables: result.tables.length,
            rows: result.tables.reduce((sum, table) => sum + table.inserted + table.updated + table.deleted, 0),
            onConflict: request.onConflict ?? "abort",
            uid: user?.uid ?? "unknown",
            ...(c.get("apiKey") ? { apiKey: c.get("apiKey")?.id } : {}),
            requestId: c.get("requestId")
        });
        return c.json(result);
    });

    return router;
}
