import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

import { renderHook } from "@testing-library/react";
import { useEditorAIController } from "../editor/useEditorAIController";

/**
 * The editor's inline continuation.
 *
 * Small, but it was the FireCMS-era code that demanded a Firebase ID token and
 * threw `"Firebase token is required"` without one — in a Rebase app there is
 * no such thing. The property worth pinning is that it now needs no token at
 * all, and that its streamed deltas reach the editor in order.
 */
jest.mock("@rebasepro/admin", () => ({}));

function streamingResponse(chunks: string[]): any {
    const encoder = new TextEncoder();
    let i = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => i < chunks.length
                    ? { done: false,
value: encoder.encode(chunks[i++]) }
                    : { done: true,
value: undefined }
            })
        }
    };
}

afterEach(() => jest.restoreAllMocks());

describe("useEditorAIController", () => {

    it("streams deltas in order and resolves with the whole continuation", async () => {
        (global as any).fetch = jest.fn().mockResolvedValue(streamingResponse([
            'event: delta\ndata: {"text":"made of "}\n\n',
            'event: delta\ndata: {"text":"stainless steel"}\n\n',
            "event: done\ndata: {}\n\n"
        ]));

        const { result } = renderHook(() => useEditorAIController());
        const seen: string[] = [];
        const text = await result.current.autocomplete("The burrs are ", " Ships worldwide.", d => seen.push(d));

        expect(seen).toEqual(["made of ", "stainless steel"]);
        expect(text).toBe("made of stainless steel");
    });

    it("needs no auth token — it does not send one, and does not demand one", async () => {
        const fetchMock = jest.fn().mockResolvedValue(streamingResponse(["event: done\ndata: {}\n\n"]));
        (global as any).fetch = fetchMock;

        const { result } = renderHook(() => useEditorAIController());
        await expect(result.current.autocomplete("a", "b", () => undefined)).resolves.toBe("");

        const [, init] = fetchMock.mock.calls[0];
        expect(init.headers).toEqual({ "Content-Type": "application/json" });
        expect(JSON.stringify(init)).not.toMatch(/Bearer|Basic|token/i);
    });

    it("sends the caret context the editor gave it", async () => {
        const fetchMock = jest.fn().mockResolvedValue(streamingResponse(["event: done\ndata: {}\n\n"]));
        (global as any).fetch = fetchMock;

        const { result } = renderHook(() => useEditorAIController());
        await result.current.autocomplete("before", "after", () => undefined);

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ textBefore: "before",
textAfter: "after" });
    });

    it("honours a custom endpoint, so a self-hoster can proxy it", async () => {
        const fetchMock = jest.fn().mockResolvedValue(streamingResponse(["event: done\ndata: {}\n\n"]));
        (global as any).fetch = fetchMock;

        const { result } = renderHook(() => useEditorAIController({ endpoint: "https://ai.example.com" }));
        await result.current.autocomplete("a", "b", () => undefined);

        expect(fetchMock.mock.calls[0][0]).toBe("https://ai.example.com/autocomplete");
    });

    it("surfaces the service's message when it refuses", async () => {
        (global as any).fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 429,
            json: async () => ({ error: { message: "The free AI quota for today has been used up." } })
        });

        const { result } = renderHook(() => useEditorAIController());
        await expect(result.current.autocomplete("a", "b", () => undefined)).rejects.toThrow(/quota for today/);
    });
});
