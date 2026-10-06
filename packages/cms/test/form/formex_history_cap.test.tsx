/**
 * The form's undo history keeps the last 200 steps, not every keystroke ever.
 *
 * Each keystroke pushed a full snapshot of the values and nothing was ever
 * dropped: typing inside one item of a 500-item array kept a cloned 500-slot
 * array per character — 43.5 MB after 10,000 keystrokes — and a change saved
 * elsewhere re-merged every one of those snapshots onto the new baseline.
 */
import { act, renderHook } from "@testing-library/react";
import { useCreateFormex, FORMEX_MAX_UNDO_STEPS } from "@rebasepro/forms";

type Doc = { title: string };

describe("the undo history", () => {

    it("keeps 200 steps", () => {
        expect(FORMEX_MAX_UNDO_STEPS).toBe(200);
    });

    it("steps back through the last 200 edits, and no further", () => {
        const { result } = renderHook(() => useCreateFormex<Doc>({ initialValues: { title: "" } }));

        act(() => {
            for (let i = 1; i <= 1000; i++) result.current.setFieldValue("title", "t" + i);
        });
        expect(result.current.values.title).toBe("t1000");

        let steps = 0;
        while (result.current.canUndo && steps < 2000) {
            act(() => result.current.undo());
            steps++;
        }
        expect(steps).toBe(200);
        expect(result.current.values.title).toBe("t800");

        // And forward again, all the way.
        while (result.current.canRedo) act(() => result.current.redo());
        expect(result.current.values.title).toBe("t1000");
    });

    it("still steps back across an undoable reset at the edge of the history", () => {
        const { result } = renderHook(() => useCreateFormex<Doc>({ initialValues: { title: "" } }));

        act(() => {
            for (let i = 1; i <= 300; i++) result.current.setFieldValue("title", "t" + i);
        });
        act(() => result.current.resetForm({ values: { title: "" }, undoable: true }));
        expect(result.current.values.title).toBe("");

        act(() => result.current.undo());
        expect(result.current.values.title).toBe("t300");
    });
});
