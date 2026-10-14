/**
 * @jest-environment jsdom
 */
/**
 * `onValuesChangeDeferred` is how the record form writes its draft backup, 300
 * ms after the last edit. The timer was never cancelled: a save within those
 * 300 ms cleared the draft, and the timer then wrote it back — so the next new
 * record opened with "Unsaved local changes" holding the one just created, and
 * applying them made a duplicate. A reset (discard) had the same race, and a
 * form closed inside the window reported its draft only after it had gone.
 *
 * Now a submit reports the pending values before it saves, so the save is the
 * last word; a reset drops them; and an unmount reports them at once.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, renderHook } from "@testing-library/react";
import { useCreateFormex } from "@rebasepro/forms";

type Tag = { name: string };

/** What happened, in order: each deferred report, and each submit. */
let events: string[];

function setup() {
    return renderHook(() => useCreateFormex<Tag>({
        initialValues: { name: "" },
        onValuesChangeDeferred: (values) => { events.push(`draft:${values.name}`); },
        onSubmit: (values) => { events.push(`submit:${values.name}`); }
    }));
}

beforeEach(() => {
    events = [];
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

describe("the deferred values report", () => {
    it("still comes 300 ms after the last edit", () => {
        const { result } = setup();

        act(() => { result.current.setFieldValue("name", "physics"); });
        expect(events).toEqual([]);
        act(() => { jest.advanceTimersByTime(300); });

        expect(events).toEqual(["draft:physics"]);
    });

    it("comes before a submit made inside the window, and never after it", async () => {
        const { result } = setup();

        act(() => { result.current.setFieldValue("name", "physics"); });
        await act(async () => { await result.current.handleSubmit(); });
        act(() => { jest.advanceTimersByTime(1000); });

        expect(events).toEqual(["draft:physics", "submit:physics"]);
    });

    it("is dropped by a reset made inside the window", () => {
        const { result } = setup();

        act(() => { result.current.setFieldValue("name", "physics"); });
        act(() => { result.current.resetForm(); });
        act(() => { jest.advanceTimersByTime(1000); });

        expect(events).toEqual([]);
    });

    it("comes at once when the form unmounts inside the window, and not again", () => {
        const { result, unmount } = setup();

        act(() => { result.current.setFieldValue("name", "physics"); });
        unmount();
        expect(events).toEqual(["draft:physics"]);
        act(() => { jest.advanceTimersByTime(1000); });

        expect(events).toEqual(["draft:physics"]);
    });
});
