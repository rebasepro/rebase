import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

import {
    DEFAULT_AI_ENDPOINT,
    autocompleteStream,
    autofillStream,
    clearAiStatusCache,
    fetchAiStatus,
    fetchAiStatusCached,
    fetchPromptSuggestions
} from "../api";
import { AutofillRequest } from "../types/data_enhancement_controller";

/**
 * The transport.
 *
 * This exists because of what it replaced. The old client split each network
 * chunk on the literal `"&$# "` and `JSON.parse`d the pieces — so a delimiter
 * landing across two reads corrupted the parse, and reads land wherever the
 * network puts them. The central test below therefore re-delivers the same
 * response one byte at a time and asserts the result is identical to
 * delivering it whole. Anything that only ever feeds a complete body would
 * have passed against the old code too.
 */

/** A `Response` whose body yields exactly the chunks given, in order. */
function streamingResponse(chunks: string[], ok = true): any {
    const encoder = new TextEncoder();
    let i = 0;
    return {
        ok,
        status: ok ? 200 : 500,
        body: {
            getReader: () => ({
                read: async () =>
                    i < chunks.length
                        ? { done: false,
value: encoder.encode(chunks[i++]) }
                        : { done: true,
value: undefined }
            })
        }
    };
}

function jsonResponse(body: unknown, ok = true, status = 200): any {
    return { ok,
status,
json: async () => body };
}

/** Split a string into fixed-size pieces, to force boundaries anywhere. */
function chunked(body: string, size: number): string[] {
    const out: string[] = [];
    for (let i = 0; i < body.length; i += size) out.push(body.slice(i, i + size));
    return out;
}

const REQUEST: AutofillRequest = {
    entityName: "Product",
    values: {},
    properties: { title: { type: "string",
fieldConfigId: "text_field" } }
};

const BODY = [
    "event: suggestion_delta",
    'data: {"key":"title","text":"Blue "}',
    "",
    "event: suggestion_delta",
    'data: {"key":"title","text":"widget"}',
    "",
    "event: suggestion",
    'data: {"key":"title","value":"Blue widget"}',
    "",
    "event: suggestion",
    'data: {"key":"stock","value":42}',
    "",
    "event: done",
    'data: {"suggestions":{"title":"Blue widget","stock":42},"usage":{"outputTokens":9}}',
    "",
    ""
].join("\n");

async function runAutofill(chunks: string[]) {
    (global as any).fetch = jest.fn().mockResolvedValue(streamingResponse(chunks));
    const deltas: [string, string][] = [];
    const values: [string, unknown][] = [];
    const result = await autofillStream({
        request: REQUEST,
        onDelta: (k, t) => deltas.push([k, t]),
        onValue: (k, v) => values.push([k, v])
    });
    return { deltas,
values,
result };
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("autofillStream", () => {
    it("reads deltas, values and the final result", async () => {
        const { deltas, values, result } = await runAutofill([BODY]);
        expect(deltas).toEqual([
            ["title", "Blue "],
            ["title", "widget"]
        ]);
        expect(values).toEqual([
            ["title", "Blue widget"],
            ["stock", 42]
        ]);
        expect(result.suggestions).toEqual({ title: "Blue widget",
stock: 42 });
        expect(result.usage).toEqual({ outputTokens: 9 });
    });

    it("produces identical results at every chunk boundary", async () => {
        const whole = await runAutofill([BODY]);
        for (let size = 1; size <= BODY.length; size++) {
            const split = await runAutofill(chunked(BODY, size));
            expect(split.deltas).toEqual(whole.deltas);
            expect(split.values).toEqual(whole.values);
            expect(split.result).toEqual(whole.result);
        }
    });

    it("handles CRLF record separators", async () => {
        // Proxies rewrite line endings, and a four-character separator sliced as
        // if it were two leaves a stray newline that eats the next `event:`.
        const { values } = await runAutofill([BODY.replace(/\n/g, "\r\n")]);
        expect(values).toEqual([
            ["title", "Blue widget"],
            ["stock", 42]
        ]);
    });

    it("ignores keep-alive comments", async () => {
        const withComments = ":keep-alive\n\n" + BODY;
        const { result } = await runAutofill([withComments]);
        expect(result.suggestions).toEqual({ title: "Blue widget",
stock: 42 });
    });

    it("joins a multi-line data field", async () => {
        const body = 'event: suggestion\ndata: {"key":"body",\ndata: "value":"two lines"}\n\n'
            + "event: done\ndata: {}\n\n";
        const { values } = await runAutofill([body]);
        expect(values).toEqual([["body", "two lines"]]);
    });

    it("keeps going past one malformed record", async () => {
        // A single bad frame must not discard fields that arrived correctly.
        const body = "event: suggestion\ndata: {not json\n\n" + BODY;
        const { values } = await runAutofill([body]);
        expect(values).toEqual([
            ["title", "Blue widget"],
            ["stock", 42]
        ]);
    });

    it("throws the message carried on an error event", async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(
            streamingResponse(['event: error\ndata: {"message":"quota exhausted"}\n\n'])
        );
        await expect(
            autofillStream({ request: REQUEST,
onDelta: () => undefined,
onValue: () => undefined })
        ).rejects.toThrow("quota exhausted");
    });

    it("surfaces the server's error envelope on a non-2xx", async () => {
        // `{ error: { message } }` is the control plane's contract. Reading it
        // is the difference between telling the operator the quota reset time
        // and telling them "Request failed with status 429".
        (global as any).fetch = jest.fn().mockResolvedValue(
            jsonResponse({ error: { message: "The free AI quota for today has been used up.",
code: "upstream_error" } }, false, 429)
        );
        await expect(
            autofillStream({ request: REQUEST,
onDelta: () => undefined,
onValue: () => undefined })
        ).rejects.toThrow(/quota for today/);
    });

    it("fails a stream that ends without a `done` record", async () => {
        // A rolled pod, a proxy timeout, a dropped connection. The body simply
        // stops. Returning `{ suggestions: {} }` for that is indistinguishable
        // from the service saying there was nothing to fill — and the operator
        // is then told, in a confident sentence, that their empty fields are
        // fields the model would not improve on.
        const truncated = [
            "event: suggestion",
            'data: {"key":"title","value":"Blue widget"}',
            "",
            "event: suggestion_delta",
            'data: {"key":"summary","text":"half a sen'
        ].join("\n");
        (global as any).fetch = jest.fn().mockResolvedValue(streamingResponse([truncated]));

        const values: [string, unknown][] = [];
        await expect(autofillStream({
            request: REQUEST,
            onDelta: () => undefined,
            onValue: (k, v) => values.push([k, v])
        })).rejects.toThrow(/ended before it finished/);

        // Whatever did arrive was still delivered — the caller keeps the fields
        // that completed and reports the run as failed.
        expect(values).toEqual([["title", "Blue widget"]]);
    });

    it("fails a stream whose every record was unreadable", async () => {
        // Zero good fields plus n discarded records is not "nothing to fill".
        const garbage = "event: suggestion\ndata: {not json\n\nevent: suggestion\ndata: {also not\n\n";
        (global as any).fetch = jest.fn().mockResolvedValue(streamingResponse([garbage]));
        await expect(
            autofillStream({ request: REQUEST,
onDelta: () => undefined,
onValue: () => undefined })
        ).rejects.toThrow(/could not be read|ended before it finished/);
    });

    it("accepts the empty run the service sends when there is nothing to fill", async () => {
        // That case is a `done` with no suggestions, not an empty body, so it
        // must stay distinguishable from a truncation.
        (global as any).fetch = jest.fn().mockResolvedValue(
            streamingResponse(['event: done\ndata: {"suggestions":{},"usage":{}}\n\n'])
        );
        await expect(
            autofillStream({ request: REQUEST,
onDelta: () => undefined,
onValue: () => undefined })
        ).resolves.toEqual({ suggestions: {},
usage: {} });
    });

    it("sends no credentials of any kind", async () => {
        // The FireCMS-era client sent the tenant's JWT as `Authorization: Basic`
        // plus a hardcoded `fcms-…` key. No external service could verify the
        // former, and the latter shipped in the published package.
        const fetchMock = jest.fn().mockResolvedValue(streamingResponse([BODY]));
        (global as any).fetch = fetchMock;
        await autofillStream({ request: REQUEST,
onDelta: () => undefined,
onValue: () => undefined });
        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers).toEqual({ "Content-Type": "application/json" });
        expect(JSON.stringify(init)).not.toMatch(/fcms-|Bearer|Basic/);
    });

    it("posts to the hosted endpoint by default and to an override when given", async () => {
        // A fresh response per call: one `streamingResponse` is a single reader,
        // and handing the same exhausted one to the second call makes it read an
        // empty body — which is now, correctly, a truncated stream.
        const fetchMock = jest.fn().mockImplementation(async () => streamingResponse([BODY]));
        (global as any).fetch = fetchMock;

        await autofillStream({ request: REQUEST,
onDelta: () => undefined,
onValue: () => undefined });
        expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_AI_ENDPOINT}/autofill`);

        await autofillStream({
            request: REQUEST,
            endpoint: "https://ai.example.com/",
            onDelta: () => undefined,
            onValue: () => undefined
        });
        // Trailing slash trimmed — otherwise the override 404s on `//autofill`.
        expect(fetchMock.mock.calls[1][0]).toBe("https://ai.example.com/autofill");
    });
});

describe("autocompleteStream", () => {
    it("concatenates deltas and returns the full continuation", async () => {
        const body = [
            'event: delta\ndata: {"text":"the quick "}',
            'event: delta\ndata: {"text":"brown fox"}',
            "event: done\ndata: {}",
            ""
        ].join("\n\n");
        (global as any).fetch = jest.fn().mockResolvedValue(streamingResponse(chunked(body, 7)));

        const seen: string[] = [];
        const text = await autocompleteStream({
            textBefore: "I saw ",
            textAfter: "",
            onDelta: (t) => seen.push(t)
        });

        expect(seen.join("")).toBe("the quick brown fox");
        expect(text).toBe("the quick brown fox");
    });
});

describe("fetchAiStatus", () => {
    it("reports available when the service says so", async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(
            jsonResponse({ available: true,
model: "claude-opus-5",
features: ["autofill"] })
        );
        await expect(fetchAiStatus({})).resolves.toEqual({
            available: true,
            model: "claude-opus-5",
            features: ["autofill"]
        });
    });

    it("reports unavailable rather than throwing when the service errors", async () => {
        // This value decides whether a button renders. Any doubt must resolve to
        // "no button" — that is the whole fix for the 404-on-click failure.
        (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse({}, false, 503));
        await expect(fetchAiStatus({})).resolves.toEqual({ available: false });
    });
});

describe("fetchAiStatusCached", () => {

    beforeEach(() => clearAiStatusCache());
    afterEach(() => clearAiStatusCache());

    it("asks the host once per endpoint, however many callers there are", async () => {
        // The provider is form-scoped, so an uncached probe is one request to
        // the host every time any record is opened — a beacon from an install
        // that may never use the feature, and enough traffic from one office
        // behind one address to spend the host's per-IP limit on nothing.
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ available: true }));
        (global as any).fetch = fetchMock;

        const answers = await Promise.all([
            fetchAiStatusCached({}),
            fetchAiStatusCached({}),
            fetchAiStatusCached({})
        ]);
        await fetchAiStatusCached({});

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(answers.every(a => a.available)).toBe(true);
    });

    it("keeps one answer per endpoint", async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ available: true }));
        (global as any).fetch = fetchMock;
        await fetchAiStatusCached({});
        await fetchAiStatusCached({ endpoint: "https://ai.example.com" });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("answers unavailable, once, when the host cannot be reached", async () => {
        const fetchMock = jest.fn().mockRejectedValue(new Error("offline"));
        (global as any).fetch = fetchMock;
        await expect(fetchAiStatusCached({})).resolves.toEqual({ available: false });
        await expect(fetchAiStatusCached({})).resolves.toEqual({ available: false });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});

describe("fetchPromptSuggestions", () => {
    it("maps the service's prompts", async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(jsonResponse({ prompts: ["A blue widget", "A red one"] }));
        await expect(fetchPromptSuggestions({ entityName: "Product" })).resolves.toEqual({
            prompts: [
                { prompt: "A blue widget",
type: "sample" },
                { prompt: "A red one",
type: "sample" }
            ]
        });
    });

    it("degrades to no suggestions instead of failing the menu", async () => {
        (global as any).fetch = jest.fn().mockRejectedValue(new Error("offline"));
        await expect(fetchPromptSuggestions({ entityName: "Product" })).resolves.toEqual({ prompts: [] });
    });
});
