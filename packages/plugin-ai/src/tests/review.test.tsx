import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";

import {
    DataEnhancementControllerProvider,
    useDataEnhancementController
} from "../components/DataEnhancementControllerProvider";

/**
 * The propose → review → apply contract.
 *
 * The design this replaced streamed generated text straight into the live form
 * fields. Its failure modes were all the same failure: the record changed
 * before anyone agreed to it. Half-written sentences appeared mid-generation,
 * heuristics guessed whether each token should append to or replace what the
 * operator had typed, and getting the old value back meant retyping it.
 *
 * So the load-bearing assertion in this file is a negative one — `setFieldValue`
 * is not called — and it is checked during streaming, after streaming, after a
 * failure, and after a discard. Everything else here is detail; that is the
 * promise.
 */

jest.mock("@rebasepro/admin", () => ({
    getFieldId: (property: { type?: string }) => (property?.type === "string" ? "text_field" : "number_field")
}));

const COLLECTION = {
    name: "Products",
    singularName: "Product",
    properties: {
        title: { type: "string",
name: "Title" },
        subtitle: { type: "string",
name: "Subtitle" },
        stock: { type: "number",
name: "Stock" }
    }
} as any;

/** A `Response` whose body yields the given chunks, in order. */
function streamingResponse(chunks: string[]): any {
    const encoder = new TextEncoder();
    let i = 0;
    return {
        ok: true,
        status: 200,
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

const AUTOFILL_BODY = [
    'event: suggestion_delta\ndata: {"key":"title","text":"Blue "}',
    'event: suggestion_delta\ndata: {"key":"title","text":"widget"}',
    'event: suggestion\ndata: {"key":"title","value":"Blue widget"}',
    'event: suggestion\ndata: {"key":"stock","value":42}',
    'event: done\ndata: {"suggestions":{"title":"Blue widget","stock":42}}',
    ""
].join("\n\n");

/** Route `/status` to an availability answer and `/autofill` to a stream. */
function mockService(autofill: () => any, available = true) {
    (global as any).fetch = jest.fn((url: string) => {
        if (String(url).endsWith("/status")) {
            return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ available,
model: "gemini-3.6-flash" }) });
        }
        if (String(url).endsWith("/autofill")) return Promise.resolve(autofill());
        return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ prompts: [] }) });
    });
}

async function mountController(formValues: Record<string, unknown> = {}) {
    const setFieldValue = jest.fn();
    const formContext = { values: formValues,
setFieldValue } as any;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <DataEnhancementControllerProvider
            path={"products"}
            collection={COLLECTION}
            formContext={formContext}
            {...({} as any)}>
            {children}
        </DataEnhancementControllerProvider>
    );

    const rendered = renderHook(() => useDataEnhancementController(), { wrapper });
    return { ...rendered,
setFieldValue };
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("autofill review", () => {

    it("never writes to the form while generating or after it finishes", async () => {
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result, setFieldValue } = await mountController({ title: "" });
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: { title: "" } });
        });

        expect(result.current.review?.status).toBe("ready");
        expect(result.current.review?.fields.length).toBe(2);
        expect(setFieldValue).not.toHaveBeenCalled();
    });

    it("accumulates streamed text into the proposal, not the field", async () => {
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result, setFieldValue } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });

        const title = result.current.review?.fields.find(f => f.key === "title");
        expect(title?.proposed).toBe("Blue widget");
        expect(title?.pending).toBe(false);
        expect(title?.label).toBe("Title");
        expect(setFieldValue).not.toHaveBeenCalled();
    });

    it("writes only the selected fields, and only on apply", async () => {
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result, setFieldValue } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });

        act(() => result.current.toggleField("stock"));
        expect(setFieldValue).not.toHaveBeenCalled();

        act(() => result.current.applyReview());

        expect(setFieldValue).toHaveBeenCalledTimes(1);
        expect(setFieldValue).toHaveBeenCalledWith("title", "Blue widget");
        // The review closes on apply — there is nothing left to decide.
        expect(result.current.review).toBeNull();
    });

    it("writes nothing when the review is discarded", async () => {
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result, setFieldValue } = await mountController({ title: "Existing" });
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: { title: "Existing" } });
        });
        act(() => result.current.dismissReview());

        expect(setFieldValue).not.toHaveBeenCalled();
        expect(result.current.review).toBeNull();
    });

    it("records what each proposal would overwrite", async () => {
        // The row shows the current value struck through, which is only possible
        // because the form was never touched — it still holds the original.
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result } = await mountController({ title: "Old title" });
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: { title: "Old title" } });
        });

        const title = result.current.review?.fields.find(f => f.key === "title");
        expect(title?.currentValue).toBe("Old title");
        expect(title?.proposed).toBe("Blue widget");
    });

    it("toggles every field at once", async () => {
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result, setFieldValue } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });

        act(() => result.current.toggleAll(false));
        act(() => result.current.applyReview());
        expect(setFieldValue).not.toHaveBeenCalled();
    });

    it("keeps the fields that arrived before a mid-stream failure", async () => {
        // A run that produced two good fields and then broke should still let
        // the operator take the two, rather than discarding the work.
        const truncated = [
            'event: suggestion\ndata: {"key":"title","value":"Blue widget"}',
            'event: error\ndata: {"message":"quota exhausted"}',
            ""
        ].join("\n\n");
        mockService(() => streamingResponse([truncated]));
        const { result, setFieldValue } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });

        expect(result.current.review?.status).toBe("failed");
        expect(result.current.review?.error).toMatch(/quota exhausted/);
        expect(result.current.review?.fields.map(f => f.key)).toEqual(["title"]);
        expect(setFieldValue).not.toHaveBeenCalled();

        act(() => result.current.applyReview());
        expect(setFieldValue).toHaveBeenCalledWith("title", "Blue widget");
    });

    it("sends values flattened onto the same dotted paths as the properties", async () => {
        // The service is told about `seo.title`, so it has to be told the value
        // of `seo.title` — not of `seo`. Sending the nested object instead makes
        // every existing value invisible to the model, which shows up as
        // autofill cheerfully overwriting things the operator already wrote.
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: { seo: { title: "Nested" } } });
        });

        const call = ((global as any).fetch as jest.Mock).mock.calls
            .find(([url]: [string]) => String(url).endsWith("/autofill"));
        expect(JSON.parse(call[1].body).values).toEqual({ "seo.title": "Nested" });
    });

    it("stays disabled when the service reports unavailable", async () => {
        mockService(() => streamingResponse([AUTOFILL_BODY]), false);
        const { result } = await mountController();
        await waitFor(() => expect((global as any).fetch).toHaveBeenCalled());
        expect(result.current.enabled).toBe(false);
        expect(result.current.review).toBeNull();
    });
});

describe("autofill review — runs that overlap or are abandoned", () => {

    it("does not write into a review the operator already dismissed", async () => {
        // Closing the dialog mid-generation must not leave late frames landing
        // in a review that is no longer on screen.
        mockService(() => streamingResponse([AUTOFILL_BODY]));
        const { result, setFieldValue } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        let pending: Promise<void>;
        act(() => {
            pending = result.current.generate({ values: {} });
        });
        act(() => result.current.dismissReview());
        await act(async () => {
            await pending!;
        });

        expect(result.current.review).toBeNull();
        expect(setFieldValue).not.toHaveBeenCalled();
    });

    it("does not let an earlier run's fields leak into a later one", async () => {
        // Two clicks in quick succession. The first run's frames must not
        // appear in the second run's review — the operator would be reviewing
        // proposals for an instruction they replaced.
        const first = [
            'event: suggestion\ndata: {"key":"title","value":"FIRST RUN"}',
            'event: done\ndata: {"suggestions":{"title":"FIRST RUN"}}',
            ""
        ].join("\n\n");
        const second = [
            'event: suggestion\ndata: {"key":"stock","value":7}',
            'event: done\ndata: {"suggestions":{"stock":7}}',
            ""
        ].join("\n\n");

        let call = 0;
        (global as any).fetch = jest.fn((url: string) => {
            if (String(url).endsWith("/status")) {
                return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ available: true }) });
            }
            if (String(url).endsWith("/autofill")) {
                return Promise.resolve(streamingResponse([call++ === 0 ? first : second]));
            }
            return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ prompts: [] }) });
        });

        const { result } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });
        await act(async () => {
            await result.current.generate({ values: {} });
        });

        const keys = result.current.review?.fields.map(f => f.key);
        expect(keys).toEqual(["stock"]);
        expect(JSON.stringify(result.current.review)).not.toMatch(/FIRST RUN/);
    });

    it("applies only the fields that finished, if applied mid-stream", async () => {
        // The Apply button counts non-pending rows; applying must honour the
        // same rule, or a half-written sentence lands in the record.
        mockService(() => streamingResponse([
            'event: suggestion_delta\ndata: {"key":"title","text":"half a sen"}\n\n' +
            'event: suggestion\ndata: {"key":"stock","value":9}\n\n'
        ]));
        const { result, setFieldValue } = await mountController();
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });

        // The stream ended without completing `title`, so it is dropped rather
        // than offered — the only thing held for it is a half-written sentence.
        expect(result.current.review?.fields.map(f => f.key)).toEqual(["stock"]);

        act(() => result.current.applyReview());

        expect(setFieldValue).toHaveBeenCalledTimes(1);
        expect(setFieldValue).toHaveBeenCalledWith("stock", 9);
    });

    it("drops a date the model returned as unparseable rather than storing NaN", async () => {
        const collection = {
            name: "Posts",
            singularName: "Post",
            properties: { publishedAt: { type: "date",
name: "Published at" } }
        } as any;

        (global as any).fetch = jest.fn((url: string) => {
            if (String(url).endsWith("/status")) {
                return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ available: true }) });
            }
            return Promise.resolve(streamingResponse([
                'event: suggestion\ndata: {"key":"publishedAt","value":"not a date"}\n\nevent: done\ndata: {"suggestions":{}}\n\n'
            ]));
        });

        const setFieldValue = jest.fn();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <DataEnhancementControllerProvider
                path={"posts"}
                collection={collection}
                formContext={{ values: {},
setFieldValue } as any}
                {...({} as any)}>
                {children}
            </DataEnhancementControllerProvider>
        );
        const { result } = renderHook(() => useDataEnhancementController(), { wrapper });
        await waitFor(() => expect(result.current.enabled).toBe(true));

        await act(async () => {
            await result.current.generate({ values: {} });
        });
        act(() => result.current.applyReview());

        expect(setFieldValue).not.toHaveBeenCalled();
    });
});
