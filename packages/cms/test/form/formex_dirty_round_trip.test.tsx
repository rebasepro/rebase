/**
 * Typing a field back to its stored value leaves the form clean.
 *
 * `setFieldValue` only ever set `dirty` to true: "a" → "ab" → "a" kept Save
 * enabled and leaving the record asked about unsaved changes that did not
 * exist.
 */
import { act, renderHook } from "@testing-library/react";
import { useCreateFormex } from "@rebasepro/forms";

type Doc = { title: string; tags: string[]; address: { city: string } };

describe("dirty after an edit is undone by hand", () => {
    const initialValues: Doc = { title: "a", tags: ["x"], address: { city: "Rome" } };

    it("is clean when the field is typed back", () => {
        const { result } = renderHook(() => useCreateFormex<Doc>({ initialValues }));
        act(() => result.current.setFieldValue("title", "ab"));
        expect(result.current.dirty).toBe(true);
        act(() => result.current.setFieldValue("title", "a"));
        expect(result.current.dirty).toBe(false);
    });

    it("stays dirty while another field still differs", () => {
        const { result } = renderHook(() => useCreateFormex<Doc>({ initialValues }));
        act(() => result.current.setFieldValue("address.city", "Milan"));
        act(() => result.current.setFieldValue("title", "ab"));
        act(() => result.current.setFieldValue("title", "a"));
        expect(result.current.dirty).toBe(true);
        act(() => result.current.setFieldValue("address.city", "Rome"));
        expect(result.current.dirty).toBe(false);
    });
});
