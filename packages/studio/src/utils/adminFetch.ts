import { useCallback, useRef } from "react";
import { useApiBase, useApiConfig, useAuthController } from "@rebasepro/app";

export class AdminRequestError extends Error {
    readonly status: number;
    readonly code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = "AdminRequestError";
        this.status = status;
        this.code = code;
    }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

export function asNullableString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

export function asBoolean(value: unknown, fallback = false): boolean {
    return typeof value === "boolean" ? value : fallback;
}

export function asNumber(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
}

/**
 * The database's own words, when the server sent them: outside production a
 * database error's envelope carries `details.dbMessage` (and its detail and
 * hint) under a generic message such as "An unexpected error occurred", and
 * that sentence is the one that says what to fix.
 */
function databaseReason(details: unknown): string | undefined {
    if (!isRecord(details) || typeof details.dbMessage !== "string" || !details.dbMessage) return undefined;
    return [
        details.dbMessage,
        typeof details.detail === "string" ? details.detail : undefined,
        typeof details.hint === "string" ? `Hint: ${details.hint}` : undefined
    ].filter(Boolean).join(" ");
}

function extractError(body: unknown, status: number, statusText: string): { message: string; code?: string } {
    if (isRecord(body)) {
        const err = body.error;
        if (isRecord(err) && typeof err.message === "string") {
            const reason = databaseReason(err.details);
            return {
                message: reason && !err.message.includes(reason) ? `${err.message}: ${reason}` : err.message,
                code: typeof err.code === "string" ? err.code : undefined
            };
        }
        if (typeof body.message === "string") {
            return { message: body.message };
        }
    }
    return { message: `${status} ${statusText}`.trim() };
}

export interface AdminFetchOptions {
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
}

/**
 * Authenticated JSON client for Rebase's `/api/*` admin and data endpoints.
 * Carries the active session or proxy token automatically.
 */
export function useAdminFetch() {
    const apiBase = useApiBase();
    const apiConfig = useApiConfig();
    const authController = useAuthController();

    const apiBaseRef = useRef(apiBase);
    apiBaseRef.current = apiBase;
    const apiConfigRef = useRef(apiConfig);
    apiConfigRef.current = apiConfig;
    const authRef = useRef(authController);
    authRef.current = authController;

    const requestJson = useCallback(async (
        path: string,
        options: AdminFetchOptions = {}
    ): Promise<unknown> => {
        const base = (apiBaseRef.current ?? "/api").replace(/\/+$/, "");
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        const url = `${base}${normalizedPath}`;

        const getToken = apiConfigRef.current?.getAuthToken ?? authRef.current.getAuthToken;
        const token = getToken ? await getToken() : null;

        const headers: Record<string, string> = {
            ...(options.headers ?? {})
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        if (options.body !== undefined && !headers["Content-Type"]) {
            headers["Content-Type"] = "application/json";
        }

        const res = await fetch(url, {
            method: options.method ?? "GET",
            headers,
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: options.signal
        });

        const text = await res.text();
        let parsed: unknown = undefined;
        if (text) {
            try {
                parsed = JSON.parse(text);
            } catch {
                parsed = text;
            }
        }

        if (!res.ok) {
            const { message, code } = extractError(parsed, res.status, res.statusText);
            throw new AdminRequestError(message, res.status, code);
        }

        return parsed;
    }, []);

    /**
     * The same authenticated request, answered as the raw `Response`: for a
     * body that is not JSON (a CSV export) or that should be streamed.
     */
    const requestRaw = useCallback(async (path: string, options: AdminFetchOptions = {}): Promise<Response> => {
        const base = (apiBaseRef.current ?? "/api").replace(/\/+$/, "");
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        const getToken = apiConfigRef.current?.getAuthToken ?? authRef.current.getAuthToken;
        const token = getToken ? await getToken() : null;
        const headers: Record<string, string> = { ...(options.headers ?? {}) };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (options.body !== undefined && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
        const res = await fetch(`${base}${normalizedPath}`, {
            method: options.method ?? "GET",
            headers,
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
            signal: options.signal
        });
        if (!res.ok) {
            const text = await res.text();
            let parsed: unknown = text;
            try {
                parsed = JSON.parse(text);
            } catch {
                // a plain-text error body
            }
            const { message, code } = extractError(parsed, res.status, res.statusText);
            throw new AdminRequestError(message, res.status, code);
        }
        return res;
    }, []);

    return { apiBase, requestJson, requestRaw };
}
