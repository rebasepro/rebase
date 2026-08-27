/**
 * "Discard changes" / "Clear form" is one click away from Save, and what it
 * throws away is everything the user typed. It goes through the undo history
 * rather than around it, so a misclick costs a ⌘Z instead of the whole edit.
 *
 * The touched map is part of that: the draft backup is extracted *through* it
 * (see `extractTouchedValues`), so values restored without it come back as a
 * form that nothing considers edited.
 */
import { act, renderHook } from "@testing-library/react";
import { useCreateFormex } from "@rebasepro/forms";

type Product = { name: string; price: number };

const stored: Product = { name: "Wooden chair", price: 100 };

function setup() {
    return renderHook(() => useCreateFormex<Product>({ initialValues: stored }));
}

describe("an undoable reset", () => {

    it("steps back into what the user had typed", () => {
        const { result } = setup();

        act(() => {
            result.current.setFieldValue("name", "Steel chair");
            result.current.setFieldTouched("name", true);
        });
        act(() => {
            result.current.setFieldValue("price", 250);
        });

        act(() => {
            result.current.resetForm({ values: stored, undoable: true });
        });

        expect(result.current.values).toEqual(stored);
        expect(result.current.dirty).toBe(false);
        expect(result.current.canUndo).toBe(true);

        act(() => {
            result.current.undo();
        });

        expect(result.current.values).toEqual({ name: "Steel chair", price: 250 });
        expect(result.current.dirty).toBe(true);
        // Restored as an edit, not as a pristine form: the touched map decides
        // what gets written to the draft backup.
        expect(result.current.touched.name).toBe(true);
    });

    it("can be redone", () => {
        const { result } = setup();

        act(() => {
            result.current.setFieldValue("name", "Steel chair");
        });
        act(() => {
            result.current.resetForm({ values: stored, undoable: true });
        });
        act(() => {
            result.current.undo();
        });
        act(() => {
            result.current.redo();
        });

        expect(result.current.values).toEqual(stored);
        expect(result.current.dirty).toBe(false);
        expect(result.current.touched.name).toBeFalsy();
    });

    it("bumps the version on the way back, so fields re-read themselves", () => {
        const { result } = setup();

        act(() => {
            result.current.setFieldValue("name", "Steel chair");
        });
        const beforeReset = result.current.version;

        act(() => {
            result.current.resetForm({ values: stored, undoable: true });
        });
        const afterReset = result.current.version;
        expect(afterReset).toBeGreaterThan(beforeReset);

        act(() => {
            result.current.undo();
        });
        // A markdown editor cleared by the reset only re-seeds when this moves.
        expect(result.current.version).toBeGreaterThan(afterReset);
    });

    it("leaves an ordinary undo alone", () => {
        const { result } = setup();

        act(() => {
            result.current.setFieldValue("name", "Steel chair");
        });
        const version = result.current.version;

        act(() => {
            result.current.undo();
        });

        expect(result.current.values).toEqual(stored);
        // No reset was crossed, so nothing is asked to re-seed — undoing a
        // keystroke must not remount every field in the form.
        expect(result.current.version).toBe(version);
    });

    it("still clears the history when the reset is not undoable", () => {
        const { result } = setup();

        act(() => {
            result.current.setFieldValue("name", "Steel chair");
        });
        act(() => {
            result.current.resetForm({ values: stored });
        });

        expect(result.current.canUndo).toBe(false);
        act(() => {
            result.current.undo();
        });
        expect(result.current.values).toEqual(stored);
    });

});
