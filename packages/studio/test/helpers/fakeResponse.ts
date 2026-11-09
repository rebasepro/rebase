/**
 * A complete `Response` for tests that run under jsdom.
 *
 * jsdom has `Headers` but no `Response`, so a fetch stub used to hand back a
 * bare `{ ok, status, body }` and cast the stub to `typeof fetch`. This is the
 * whole interface instead, so `jest.fn<typeof fetch>()` types without a cast
 * and the code under test reads a response shaped like the real one.
 */
export interface FakeResponseInit {
    status?: number;
    /** Defaults to whether `status` is in the 2xx range. */
    ok?: boolean;
    body?: ReadableStream<Uint8Array<ArrayBuffer>> | null;
    statusText?: string;
    /**
     * What `json()` resolves to (and `text()` reads as JSON). Left out, `json()`
     * parses `text`, and rejects the way a real response does when that is not
     * JSON.
     */
    json?: unknown;
    /** The raw body text. Defaults to `json` serialised, or empty. */
    text?: string;
    headers?: Record<string, string>;
}

export class FakeResponse implements Response {
    readonly headers: Headers;
    readonly ok: boolean;
    readonly redirected = false;
    readonly status: number;
    readonly statusText: string;
    readonly type: ResponseType = "basic";
    readonly url = "";
    readonly body: ReadableStream<Uint8Array<ArrayBuffer>> | null;
    readonly bodyUsed = false;
    readonly #init: FakeResponseInit;

    constructor(init: FakeResponseInit = {}) {
        this.#init = init;
        this.status = init.status ?? 200;
        this.ok = init.ok ?? (this.status >= 200 && this.status < 300);
        this.statusText = init.statusText ?? "";
        this.body = init.body ?? null;
        this.headers = new Headers(init.headers);
    }

    async json(): Promise<unknown> {
        if ("json" in this.#init) return this.#init.json;
        return JSON.parse(await this.text());
    }

    async text(): Promise<string> {
        if (this.#init.text !== undefined) return this.#init.text;
        return "json" in this.#init ? JSON.stringify(this.#init.json) : "";
    }

    async bytes(): Promise<Uint8Array<ArrayBuffer>> {
        return new TextEncoder().encode(await this.text());
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
        return (await this.bytes()).buffer;
    }

    async blob(): Promise<Blob> {
        return new Blob([await this.text()]);
    }

    async formData(): Promise<FormData> {
        throw new TypeError("A fake response carries no form data");
    }

    clone(): Response {
        return new FakeResponse(this.#init);
    }
}
