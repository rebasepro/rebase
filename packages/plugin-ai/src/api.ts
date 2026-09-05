import {
    AutofillRequest,
    AutofillResult,
    AiStatus,
    SamplePromptsResult
} from "./types/data_enhancement_controller";

/**
 * The hosted service Rebase runs for this plugin.
 *
 * **This is where the entity's field values go.** Autofill posts them to
 * generate a suggestion, and unless the host sets `endpoint`, they go to this
 * address — off their machine, to a service Rebase operates. That is disclosed
 * on the plugins page rather than only here, because the person who needs to
 * know is the one deciding whether the data in those fields may leave.
 *
 * No credential travels with them; see the note below.
 *
 * The previous value here was `https://api.rebase.pro`, a FireCMS-era host that
 * resolves but serves nothing — every path 404s — so Autofill had never worked
 * in a Rebase install. This one is served by the control plane
 * (`saas/backend/functions/ai.ts`). Point `endpoint` somewhere else to run your
 * own; the wire format below is the whole contract.
 */
export const DEFAULT_AI_ENDPOINT = "https://app.rebase.pro/api/functions/ai";

/**
 * ## No credentials cross this boundary
 *
 * The old client sent the tenant's Rebase JWT as `Authorization: Basic <jwt>`
 * plus a hardcoded `fcms-…` key compiled into the published package. Both were
 * wrong in the same way: a self-hosted backend signs its tokens with its own
 * secret, so no external service can verify one — sending it only handed a live
 * credential to a third party that had no use for it.
 *
 * These requests are anonymous. The service bounds cost by rate limit and daily
 * ceiling rather than by identity, and reports through {@link fetchAiStatus}
 * when it can no longer serve — which is what keeps the UI from offering an
 * action that is going to fail.
 */
function endpointOf(endpoint: string | undefined, path: string): string {
    return (endpoint ?? DEFAULT_AI_ENDPOINT).replace(/\/+$/, "") + path;
}

/** One `event:`/`data:` pair off the wire. */
type ServerSentEvent = { event: string; data: string };

/** Not global: `exec` must not carry `lastIndex` between buffer reads. */
const SSE_SEPARATOR = /\r?\n\r?\n/;

/**
 * Parse an SSE body incrementally.
 *
 * The framing this replaces split each chunk on the literal `"&$# "` and
 * `JSON.parse`d the pieces, which corrupted itself the moment a delimiter
 * straddled two reads — and network reads land wherever they land. Buffering
 * until a blank line is the fix, and it is also just what SSE specifies.
 */
async function* readServerSentEvents(response: Response): AsyncGenerator<ServerSentEvent> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The AI service returned no response body");

    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // A record ends at a blank line. `\r\n` is tolerated because proxies
        // rewrite line endings. The separator is located with `exec` rather
        // than `search` so its actual length is known — a `\r\n\r\n` boundary
        // is four characters, not two, and slicing by the wrong count leaves a
        // stray newline that swallows the next record's `event:` field.
        let match = SSE_SEPARATOR.exec(buffer);
        while (match) {
            const raw = buffer.slice(0, match.index);
            buffer = buffer.slice(match.index + match[0].length);
            const parsed = parseEventBlock(raw);
            if (parsed) yield parsed;
            match = SSE_SEPARATOR.exec(buffer);
        }
    }
}

function parseEventBlock(block: string): ServerSentEvent | undefined {
    let event = "message";
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) continue; // comment / keep-alive
        const separator = line.indexOf(":");
        const field = separator === -1 ? line : line.slice(0, separator);
        const rawValue = separator === -1 ? "" : line.slice(separator + 1);
        const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
        if (field === "event") event = value;
        else if (field === "data") dataLines.push(value);
    }
    if (dataLines.length === 0) return undefined;
    return { event,
data: dataLines.join("\n") };
}

/** Pull a message out of the control plane's `{ error: { message } }` envelope. */
async function errorFrom(response: Response, fallback: string): Promise<Error> {
    try {
        const body = await response.json();
        const message = body?.error?.message;
        if (typeof message === "string" && message) return new Error(message);
    } catch {
        /* not JSON — fall through */
    }
    return new Error(fallback);
}

/**
 * Ask the service whether it can serve a request at all.
 *
 * The plugin gates every affordance on this. A missing provider key, an
 * exhausted daily quota or an unreachable host all resolve to `available:
 * false`, and the Autofill button is simply not rendered — rather than
 * rendered, clicked, and failed.
 */
export async function fetchAiStatus(props: { endpoint?: string; signal?: AbortSignal }): Promise<AiStatus> {
    const response = await fetch(endpointOf(props.endpoint, "/status"), {
        method: "GET",
        signal: props.signal
    });
    if (!response.ok) return { available: false };
    const body = await response.json();
    return {
        available: Boolean(body?.available),
        model: typeof body?.model === "string" ? body.model : undefined,
        features: Array.isArray(body?.features) ? body.features : undefined
    };
}

/** One in-flight or settled probe per endpoint, for the life of the page. */
const statusProbes = new Map<string, Promise<AiStatus>>();

/**
 * {@link fetchAiStatus}, asked once per endpoint per session.
 *
 * The provider is form-scoped, so the uncached call meant one request to the
 * host every time any record was opened — a beacon on an install that may never
 * click Autofill, and enough traffic from one NAT'd office to spend the host's
 * per-IP rate limit on nothing, which reads back as `available: false` and makes
 * the button flicker in and out for everyone behind it.
 *
 * Availability changes on the order of a deploy or a daily quota reset, not of a
 * form open, so a session-long answer is the right resolution. Failures resolve
 * to `available: false` and are cached like any other answer — retrying per form
 * open is the behaviour this replaces.
 */
export function fetchAiStatusCached(props: { endpoint?: string }): Promise<AiStatus> {
    const key = endpointOf(props.endpoint, "/status");
    const existing = statusProbes.get(key);
    if (existing) return existing;
    const probe = fetchAiStatus({ endpoint: props.endpoint })
        .catch(() => ({ available: false }) as AiStatus);
    statusProbes.set(key, probe);
    return probe;
}

/** Forget every cached probe, so the next caller asks again. */
export function clearAiStatusCache(): void {
    statusProbes.clear();
}

/**
 * Fill a record, streaming each field as the service writes it.
 *
 * `onDelta` fires with more text for a field still being written; `onValue`
 * fires once a field is complete and carries its final, correctly typed value.
 * A caller that implements only `onValue` still ends up with the right record —
 * the deltas exist so a long text field fills in visibly instead of appearing
 * all at once.
 */
export async function autofillStream(props: {
    request: AutofillRequest;
    endpoint?: string;
    signal?: AbortSignal;
    onDelta: (key: string, text: string) => void;
    onValue: (key: string, value: unknown) => void;
}): Promise<AutofillResult> {
    const response = await fetch(endpointOf(props.endpoint, "/autofill"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(props.request),
        signal: props.signal
    });

    if (!response.ok) {
        throw await errorFrom(response, "The AI service could not complete this request.");
    }

    let result: AutofillResult = { suggestions: {} };
    let done = false;
    let delivered = 0;
    let discarded = 0;

    for await (const { event, data } of readServerSentEvents(response)) {
        let payload: any;
        try {
            payload = JSON.parse(data);
        } catch {
            // One malformed record must not abort a stream that is otherwise
            // delivering good fields — but it is counted, because a run that
            // delivered nothing *but* malformed records is a failure, not an
            // answer of "there was nothing to fill in".
            discarded++;
            continue;
        }

        if (event === "suggestion_delta") {
            delivered++;
            props.onDelta(payload.key, payload.text);
        } else if (event === "suggestion") {
            delivered++;
            props.onValue(payload.key, payload.value);
        } else if (event === "done") {
            done = true;
            result = {
                suggestions: payload.suggestions ?? {},
                usage: payload.usage
            };
        } else if (event === "error") {
            throw new Error(payload.message ?? "The AI service reported an error.");
        }
    }

    // The service closes every run it finished with a `done` record — including
    // the run that had nothing to fill, which is an empty `done` and not an
    // empty body. So a body that simply stops is a truncation: a rolled pod, a
    // proxy timeout, a dropped connection. Reported as one, because the caller's
    // only other reading of an empty result is "nothing needed filling", and
    // telling an operator that their empty fields are fields the model would not
    // improve on is a confident, wrong answer they have no way to question.
    if (!done) {
        throw new Error("The connection to the AI service ended before it finished.");
    }
    if (discarded > 0 && delivered === 0) {
        throw new Error("The AI service's response could not be read.");
    }

    return result;
}

/** Inline continuation for the rich-text editor. Streams plain text. */
export async function autocompleteStream(props: {
    textBefore?: string;
    textAfter?: string;
    endpoint?: string;
    signal?: AbortSignal;
    onDelta: (text: string) => void;
}): Promise<string> {
    const response = await fetch(endpointOf(props.endpoint, "/autocomplete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            textBefore: props.textBefore ?? "",
            textAfter: props.textAfter ?? ""
        }),
        signal: props.signal
    });

    if (!response.ok) {
        throw await errorFrom(response, "The AI service could not complete this request.");
    }

    let text = "";
    for await (const { event, data } of readServerSentEvents(response)) {
        let payload: any;
        try {
            payload = JSON.parse(data);
        } catch {
            continue;
        }
        if (event === "error") {
            throw new Error(payload?.message ?? "The AI service reported an error.");
        }
        if (event === "delta" && typeof payload?.text === "string") {
            text += payload.text;
            props.onDelta(payload.text);
        }
    }
    return text;
}

/**
 * Sample prompts for the Autofill menu.
 *
 * Failure is deliberately not thrown: the menu has built-in prompts to fall
 * back on, and an empty suggestion list is a far better outcome than an error
 * toast for something nobody asked for.
 */
export async function fetchPromptSuggestions(props: {
    entityName: string;
    /** Ties suggestions to the domain — see the note on the service's side. */
    entityDescription?: string;
    input?: string;
    endpoint?: string;
    signal?: AbortSignal;
}): Promise<SamplePromptsResult> {
    try {
        const response = await fetch(endpointOf(props.endpoint, "/prompts"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                entityName: props.entityName,
                entityDescription: props.entityDescription,
                input: props.input
            }),
            signal: props.signal
        });
        if (!response.ok) return { prompts: [] };
        const body = await response.json();
        const prompts: string[] = Array.isArray(body?.prompts) ? body.prompts : [];
        return {
            prompts: prompts
                .filter((p): p is string => typeof p === "string")
                .map((prompt) => ({ prompt,
type: "sample" as const }))
        };
    } catch {
        return { prompts: [] };
    }
}
