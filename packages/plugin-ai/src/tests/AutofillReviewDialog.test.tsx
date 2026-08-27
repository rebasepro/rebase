import { TextEncoder, TextDecoder } from "util";
Object.assign(global, { TextEncoder,
TextDecoder });

if (typeof window !== "undefined") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: jest.fn().mockImplementation(query => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
            dispatchEvent: jest.fn()
        }))
    });
}

import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
    DataEnhancementControllerProvider,
    useDataEnhancementController
} from "../components/DataEnhancementControllerProvider";
import { AutofillReviewDialog } from "../components/AutofillReviewDialog";
import { DataEnhancementController } from "../types/data_enhancement_controller";

/**
 * The review surface.
 *
 * The controller's behaviour is covered in `review.test.tsx`; this is about
 * what the operator can actually see and press. The two things worth proving
 * here are that a proposal which would overwrite existing content *says so* —
 * a review that hides what it is about to destroy is worse than no review — and
 * that the Apply button's count matches what Apply will really write.
 */

jest.mock("@rebasepro/cms", () => ({
    getFieldId: (property: { type?: string }) => (property?.type === "string" ? "text_field" : "number_field")
}));

const COLLECTION = {
    name: "Products",
    singularName: "Product",
    properties: {
        title: { type: "string",
name: "Title" },
        stock: { type: "number",
name: "Stock" }
    }
} as any;

function streamingResponse(body: string): any {
    const encoder = new TextEncoder();
    let sent = false;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => {
                    if (sent) return { done: true,
value: undefined };
                    sent = true;
                    return { done: false,
value: encoder.encode(body) };
                }
            })
        }
    };
}

const FULL_RUN = [
    'event: suggestion\ndata: {"key":"title","value":"Blue widget"}',
    'event: suggestion\ndata: {"key":"stock","value":42}',
    'event: done\ndata: {"suggestions":{"title":"Blue widget","stock":42}}',
    ""
].join("\n\n");

function mockService(autofillBody: string | (() => any)) {
    (global as any).fetch = jest.fn((url: string) => {
        if (String(url).endsWith("/status")) {
            return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ available: true }) });
        }
        if (String(url).endsWith("/autofill")) {
            return Promise.resolve(typeof autofillBody === "string" ? streamingResponse(autofillBody) : autofillBody());
        }
        return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ prompts: [] }) });
    });
}

let controller: DataEnhancementController;

function Capture() {
    controller = useDataEnhancementController();
    return null;
}

async function mount(formValues: Record<string, unknown> = {}) {
    const setFieldValue = jest.fn();
    const formContext = { values: formValues,
setFieldValue } as any;

    render(
        <DataEnhancementControllerProvider
            path={"products"}
            collection={COLLECTION}
            formContext={formContext}
            {...({} as any)}>
            <Capture/>
            <AutofillReviewDialog/>
        </DataEnhancementControllerProvider>
    );

    // Let the /status probe resolve so the controller reports enabled.
    await act(async () => {
        await Promise.resolve();
    });

    return { setFieldValue };
}

async function runAutofill(values: Record<string, unknown> = {}) {
    await act(async () => {
        await controller.generate({ values });
    });
}

afterEach(() => {
    jest.restoreAllMocks();
});

describe("AutofillReviewDialog", () => {

    it("renders nothing until a run has produced something to review", async () => {
        mockService(FULL_RUN);
        await mount();
        expect(screen.queryByText(/Review autofill/i)).toBeNull();
    });

    it("lists each proposed field with its label and value", async () => {
        mockService(FULL_RUN);
        await mount();
        await runAutofill();

        expect(screen.getByText("Review autofill")).toBeTruthy();
        expect(screen.getByText("Title")).toBeTruthy();
        expect(screen.getByText("Blue widget")).toBeTruthy();
        expect(screen.getByText("Stock")).toBeTruthy();
        expect(screen.getByText("42")).toBeTruthy();
    });

    it("says so when a proposal would overwrite something already written", async () => {
        // The property that makes this a review rather than a preview. Hiding
        // what is about to be destroyed is worse than not offering a review.
        mockService(FULL_RUN);
        await mount({ title: "Hand grinder" });
        await runAutofill({ title: "Hand grinder" });

        expect(screen.getAllByText(/replaces the current value/i).length).toBe(1);
        expect(screen.getByText("Hand grinder")).toBeTruthy();
    });

    it("does not claim a replacement for a field that was empty", async () => {
        mockService(FULL_RUN);
        await mount({ title: "" });
        await runAutofill({ title: "" });

        expect(screen.queryByText(/replaces the current value/i)).toBeNull();
    });

    it("counts only the fields Apply will actually write", async () => {
        mockService(FULL_RUN);
        await mount();
        await runAutofill();

        expect(screen.getByRole("button", { name: /Apply 2 fields/i })).toBeTruthy();

        const user = userEvent.setup();
        const rows = screen.getAllByRole("checkbox");
        // The first checkbox is "select all"; the next two are the fields.
        await act(async () => {
            await user.click(rows[rows.length - 1]);
        });

        expect(screen.getByRole("button", { name: /Apply 1 field/i })).toBeTruthy();
    });

    it("writes only the ticked fields when Apply is pressed", async () => {
        mockService(FULL_RUN);
        const { setFieldValue } = await mount();
        await runAutofill();

        const user = userEvent.setup();
        const boxes = screen.getAllByRole("checkbox");
        await act(async () => {
            await user.click(boxes[boxes.length - 1]);
        });
        await act(async () => {
            await user.click(screen.getByRole("button", { name: /Apply 1 field/i }));
        });

        expect(setFieldValue).toHaveBeenCalledTimes(1);
        expect(setFieldValue).toHaveBeenCalledWith("title", "Blue widget");
    });

    it("writes nothing when Discard is pressed, and closes", async () => {
        mockService(FULL_RUN);
        const { setFieldValue } = await mount({ title: "Original" });
        await runAutofill({ title: "Original" });

        const user = userEvent.setup();
        await act(async () => {
            await user.click(screen.getByRole("button", { name: /Discard/i }));
        });

        expect(setFieldValue).not.toHaveBeenCalled();
        expect(screen.queryByText("Review autofill")).toBeNull();
    });

    it("disables Apply when nothing is ticked", async () => {
        mockService(FULL_RUN);
        await mount();
        await runAutofill();

        const user = userEvent.setup();
        await act(async () => {
            await user.click(screen.getAllByRole("checkbox")[0]);
        });

        const apply = screen.getByRole("button", { name: /Apply 0 fields/i });
        expect(apply.hasAttribute("disabled")).toBe(true);
    });

    it("shows the instruction back to the operator while they review", async () => {
        mockService(FULL_RUN);
        await mount();
        await act(async () => {
            await controller.generate({ values: {},
instructions: "A burr grinder for travel" });
        });

        expect(screen.getByText(/A burr grinder for travel/)).toBeTruthy();
    });

    it("keeps what arrived when a run fails part-way, and explains", async () => {
        // A run that produced one good field and then broke should still let
        // the operator take the one.
        mockService([
            'event: suggestion\ndata: {"key":"title","value":"Blue widget"}',
            'event: error\ndata: {"message":"quota exhausted"}',
            ""
        ].join("\n\n"));
        await mount();
        await runAutofill();

        expect(screen.getByText(/quota exhausted/)).toBeTruthy();
        expect(screen.getByText("Blue widget")).toBeTruthy();
        expect(screen.getByRole("button", { name: /Apply 1 field/i })).toBeTruthy();
    });

    it("explains an empty result rather than showing a blank dialog", async () => {
        mockService('event: done\ndata: {"suggestions":{}}\n\n');
        await mount();
        await runAutofill();

        expect(screen.getByText(/Nothing to fill in/i)).toBeTruthy();
        expect(screen.getByRole("button", { name: /Apply 0 fields/i })).toBeTruthy();
    });

    it("offers select-all only when there is more than one field", async () => {
        mockService('event: suggestion\ndata: {"key":"title","value":"Only one"}\n\nevent: done\ndata: {"suggestions":{"title":"Only one"}}\n\n');
        await mount();
        await runAutofill();

        expect(screen.queryByText(/Select all|Deselect all/i)).toBeNull();
        expect(screen.getAllByRole("checkbox").length).toBe(1);
    });

    it("toggles every row at once", async () => {
        mockService(FULL_RUN);
        await mount();
        await runAutofill();

        const user = userEvent.setup();
        await act(async () => {
            await user.click(screen.getByText(/Deselect all/i));
        });

        expect(screen.getByRole("button", { name: /Apply 0 fields/i })).toBeTruthy();
        expect(screen.getByText(/Select all/i)).toBeTruthy();
    });

    it("renders a date proposal readably rather than as an ISO string", async () => {
        const collection = {
            name: "Posts",
            singularName: "Post",
            properties: { publishedAt: { type: "date",
name: "Published at" } }
        } as any;

        (global as any).fetch = jest.fn((url: string) => {
            if (String(url).endsWith("/status")) return Promise.resolve({ ok: true,
status: 200,
json: async () => ({ available: true }) });
            return Promise.resolve(streamingResponse(
                'event: suggestion\ndata: {"key":"publishedAt","value":"2026-08-03T10:00:00.000Z"}\n\nevent: done\ndata: {"suggestions":{}}\n\n'
            ));
        });

        const setFieldValue = jest.fn();
        render(
            <DataEnhancementControllerProvider
                path={"posts"}
                collection={collection}
                formContext={{ values: {},
setFieldValue } as any}
                {...({} as any)}>
                <Capture/>
                <AutofillReviewDialog/>
            </DataEnhancementControllerProvider>
        );
        await act(async () => {
            await Promise.resolve();
        });
        await runAutofill();

        // Not the raw ISO string — the row shows a locale-formatted date, which
        // is only possible because the controller coerced it to a Date first.
        expect(screen.queryByText("2026-08-03T10:00:00.000Z")).toBeNull();
        const row = screen.getByText("Published at").closest("label[class*=\"flex\"]");
        expect(within(row as HTMLElement).getByText(/2026/)).toBeTruthy();
    });
});
