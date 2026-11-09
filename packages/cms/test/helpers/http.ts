/**
 * Typed stand-ins for `fetch` and the `Response` it resolves with.
 *
 * jsdom has no Fetch API, so a test that serves the admin's HTTP calls builds
 * the response itself. These build complete `Response` and `Headers` objects,
 * so the code under test reads what a real one would hand it.
 */
import { jest } from "@jest/globals";

/** A `Headers` over a plain map; names are case-insensitive, as in the real one. */
class TestHeaders implements Headers {
    private readonly map = new Map<string, string>();

    constructor(init: Record<string, string> = {}) {
        for (const [name, value] of Object.entries(init)) this.set(name, value);
    }

    append(name: string, value: string): void {
        const key = name.toLowerCase();
        const existing = this.map.get(key);
        this.map.set(key, existing === undefined ? value : `${existing}, ${value}`);
    }

    delete(name: string): void {
        this.map.delete(name.toLowerCase());
    }

    get(name: string): string | null {
        return this.map.get(name.toLowerCase()) ?? null;
    }

    getSetCookie(): string[] {
        const cookie = this.get("set-cookie");
        return cookie === null ? [] : [cookie];
    }

    has(name: string): boolean {
        return this.map.has(name.toLowerCase());
    }

    set(name: string, value: string): void {
        this.map.set(name.toLowerCase(), value);
    }

    forEach(callback: (value: string, key: string, parent: Headers) => void): void {
        this.map.forEach((value, key) => callback(value, key, this));
    }

    entries(): HeadersIterator<[string, string]> {
        return this.map.entries();
    }

    keys(): HeadersIterator<string> {
        return this.map.keys();
    }

    values(): HeadersIterator<string> {
        return this.map.values();
    }

    [Symbol.iterator](): HeadersIterator<[string, string]> {
        return this.map.entries();
    }
}

export interface ResponseInitLike {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
}

/** A response whose body is `text`. */
export function textResponse(text: string, init: ResponseInitLike = {}): Response {
    const status = init.status ?? 200;
    const bytes = () => new TextEncoder().encode(text);
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: init.statusText ?? "",
        headers: new TestHeaders(init.headers),
        redirected: false,
        type: "basic",
        url: "",
        body: null,
        bodyUsed: false,
        text: async () => text,
        json: async () => JSON.parse(text),
        bytes: async () => bytes(),
        arrayBuffer: async () => bytes().buffer,
        blob: async () => new Blob([text]),
        formData: async () => {
            throw new TypeError("The body is not form data.");
        },
        clone: () => textResponse(text, init)
    };
}

/** A JSON response, as an API route answers. */
export function jsonResponse(body: unknown, init: ResponseInitLike = {}): Response {
    return textResponse(JSON.stringify(body), {
        ...init,
        headers: { "content-type": "application/json", ...init.headers }
    });
}

/** The URL a `fetch` call was made with, whichever form it was given in. */
export function urlOf(input: RequestInfo | URL): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.href;
    return input.url;
}

/** A mock `fetch` that answers every call through `handler`, by URL. */
export function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
    return jest.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => handler(urlOf(input), init));
}
