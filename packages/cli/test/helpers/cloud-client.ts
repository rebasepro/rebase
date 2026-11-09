import { createRebaseClient } from "@rebasepro/client";
import type { FunctionInvokeOptions, RebaseSession, User } from "@rebasepro/types";
import type { CloudClient } from "../../src/commands/cloud/context";

/**
 * A real control-plane SDK client whose answers come from the test.
 *
 * The cloud commands are handed a full `CloudClient` by `requireClient`, and a
 * partial object in its place had to be cast to get there. This builds the
 * real one instead and answers it from the outside:
 *
 * - `functions.invoke` is replaced by one that records the exact arguments the
 *   command passed to `invoke` and hands back `invoke`'s answer as JSON, which
 *   is what the real transport does with a function's response body.
 * - The data layer and `auth.getUser` go over the wire, to a `fetch` that routes
 *   each request to the matching `collection(slug)` answer. An absent row is a
 *   404, as the server answers it; an answer that throws an error carrying a
 *   `status` becomes a response with that status.
 * - `auth.getSession` and `auth.refreshSession` answer from `session` and
 *   `refreshSession`.
 *
 * Anything else the command reaches for is a request nobody answers, and fails
 * loudly with its method and path.
 */

/** What `client.functions.invoke(name, payload, options)` answers. */
export type InvokeAnswer = (name: string, payload?: unknown, options?: FunctionInvokeOptions) => unknown;

/** What one collection answers. Each may be sync or async; an omitted one answers as an empty backend. */
export interface CollectionAnswers {
    /** The page of rows `find` returns. */
    find?: () => unknown;
    /** The row, or `undefined` for none. */
    findById?: (id: string) => unknown;
    create?: (data: Record<string, unknown>) => unknown;
    update?: (id: string, data: Record<string, unknown>) => unknown;
    delete?: (id: string) => unknown;
}

/** A session as the tests describe one: what is not given is filled in. */
export interface SessionAnswer {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    user?: Partial<User>;
}

export interface CloudClientAnswers {
    invoke?: InvokeAnswer;
    collection?: (slug: string) => CollectionAnswers;
    /** `auth.getSession()`; `null` is signed out. Omitted: a session that does not expire soon. */
    session?: SessionAnswer | null | (() => SessionAnswer | null);
    /** `auth.getUser()`. */
    user?: Partial<User>;
    /** `auth.refreshSession()`. */
    refreshSession?: () => unknown;
}

export const CLOUD_URL = "https://cp.example";

/** A full `User` from the fields a test cares about. */
export function userOf(fields: Partial<User> = {}): User {
    return {
        uid: "user_1",
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "password",
        isAnonymous: false,
        ...fields
    };
}

/** A full `RebaseSession` from what a test gives. */
export function sessionOf(answer: SessionAnswer): RebaseSession {
    return {
        accessToken: answer.accessToken,
        refreshToken: answer.refreshToken ?? "refresh",
        expiresAt: answer.expiresAt ?? Date.now() + 60 * 60_000,
        user: userOf(answer.user)
    };
}

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value ?? null), { status, headers: { "Content-Type": "application/json" } });
}

function statusOf(error: unknown): number | undefined {
    if (!(error instanceof Error) || !("status" in error)) return undefined;
    return typeof error.status === "number" ? error.status : undefined;
}

async function answered(run: () => unknown, absent: () => Response, present: (value: unknown) => Response): Promise<Response> {
    try {
        const value = await run();
        return value === undefined ? absent() : present(value);
    } catch (error) {
        const status = statusOf(error);
        if (status === undefined) throw error;
        const message = error instanceof Error ? error.message : String(error);
        return json({ error: { message, code: "TEST_REFUSAL" } }, status);
    }
}

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
    if (typeof init?.body !== "string") return {};
    const parsed: unknown = JSON.parse(init.body);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {};
}

function routeTo(answers: CloudClientAnswers): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
    return async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const method = (init?.method ?? "GET").toUpperCase();
        const notFound = () => json({ error: { message: "Not found", code: "NOT_FOUND" } }, 404);

        if (url.pathname.endsWith("/auth/me") && answers.user) {
            return json({ user: userOf(answers.user) });
        }

        const data = url.pathname.match(/\/data\/([^/]+)(?:\/([^/]+))?$/);
        if (data) {
            const slug = decodeURIComponent(data[1]);
            const id = data[2] === undefined ? undefined : decodeURIComponent(data[2]);
            const collection = answers.collection?.(slug) ?? {};
            if (method === "GET" && id !== undefined) {
                return answered(() => collection.findById?.(id), notFound, (row) => json(row));
            }
            if ((method === "GET" && id === undefined) || (method === "POST" && id === "query")) {
                return answered(() => collection.find?.() ?? { data: [] }, () => json({ data: [] }), (page) => json(page));
            }
            if (method === "POST" && id === undefined) {
                const body = bodyOf(init);
                return answered(() => collection.create ? collection.create(body) : body, () => json({}), (row) => json(row));
            }
            if (method === "PATCH" && id !== undefined) {
                const body = bodyOf(init);
                return answered(() => collection.update?.(id, body) ?? body, () => json({}), (row) => json(row));
            }
            if (method === "DELETE" && id !== undefined) {
                return answered(() => collection.delete?.(id), () => new Response(null, { status: 204 }), () => new Response(null, { status: 204 }));
            }
        }
        throw new Error(`The test client has no answer for ${method} ${url.pathname}`);
    };
}

/** A function's answer, read back from JSON as the transport reads a response body. */
async function overTheWire<T>(value: unknown): Promise<T> {
    return new Response(JSON.stringify(value ?? null)).json();
}

export function fakeCloudClient(answers: CloudClientAnswers = {}): CloudClient {
    const client = createRebaseClient({ baseUrl: CLOUD_URL, realtime: false, fetch: routeTo(answers) });
    const invoke = answers.invoke;
    client.functions = {
        // The arguments go through as the command passed them, so a test's
        // `toHaveBeenCalledWith` sees the same call it would have on the client.
        async invoke<T>(...args: Parameters<InvokeAnswer>): Promise<T> {
            return overTheWire<T>(invoke ? await invoke(...args) : {});
        }
    };
    client.auth.getSession = () => {
        const session = typeof answers.session === "function" ? answers.session() : answers.session;
        if (session === null) return null;
        return sessionOf(session ?? { accessToken: "t" });
    };
    const refreshSession = answers.refreshSession;
    if (refreshSession) {
        client.auth.refreshSession = async () => {
            await refreshSession();
            const session = client.auth.getSession();
            if (!session) throw new Error("No session to refresh");
            return session;
        };
    }
    return client;
}
