/**
 * A record that changes under an open, edited form.
 *
 * The edit view keeps the form's baseline live (`listenById`), and save writes
 * the difference between the form's values and that live record. When the
 * baseline moved while the form was dirty, `useCreateFormex` kept the whole
 * value object — including the old value of every field the user never
 * touched. Save then "changed" those fields back: user A edits the title, user
 * B publishes the post, A saves, and the post is unpublished with nobody told.
 *
 * Now the edit is rebased onto the new baseline: a field the user did not
 * touch takes the new value, a field they did keeps theirs, and a field both
 * changed is reported as a conflict.
 */
import { act, renderHook } from "@testing-library/react";
import { useCreateFormex } from "@rebasepro/forms";
import { getChangedProperties } from "../../src/form/form_utils";

type Post = {
    title: string;
    status: string;
    seo?: { slug: string; description: string };
    tags?: string[];
};

function setup(stored: Post, onBaselineConflict?: (paths: string[]) => void) {
    return renderHook(({ baseline }) => useCreateFormex<Post>({
        initialValues: baseline,
        onBaselineConflict
    }), { initialProps: { baseline: stored } });
}

describe("a baseline that moves under a dirty form", () => {

    it("does not write back the old value of a field the user never touched", () => {
        const opened: Post = { title: "Draft", status: "review" };
        const { result, rerender } = setup(opened);

        act(() => {
            result.current.setFieldValue("title", "Draft v2");
        });

        // Someone else publishes it; the live record arrives.
        const live: Post = { title: "Draft", status: "published" };
        rerender({ baseline: live });

        expect(result.current.values).toEqual({ title: "Draft v2", status: "published" });
        expect(result.current.dirty).toBe(true);
        expect(getChangedProperties(result.current.values, live)).toEqual({ title: "Draft v2" });
    });

    it("rebases inside a nested map, field by field", () => {
        const opened: Post = { title: "T", status: "draft", seo: { slug: "t", description: "old" } };
        const { result, rerender } = setup(opened);

        act(() => {
            result.current.setFieldValue("seo.slug", "my-title");
        });
        rerender({ baseline: { title: "T", status: "draft", seo: { slug: "t", description: "new" } } });

        expect(result.current.values.seo).toEqual({ slug: "my-title", description: "new" });
    });

    it("keeps the user's value where both sides changed a field, and reports it", () => {
        const conflicts: string[][] = [];
        const opened: Post = { title: "Draft", status: "review", tags: ["a"] };
        const { result, rerender } = setup(opened, (paths) => conflicts.push(paths));

        act(() => {
            result.current.setFieldValue("title", "Mine");
            result.current.setFieldValue("tags", ["a", "b"]);
        });
        rerender({ baseline: { title: "Theirs", status: "published", tags: ["a", "c"] } });

        expect(result.current.values).toEqual({ title: "Mine", status: "published", tags: ["a", "b"] });
        expect(conflicts).toEqual([["title", "tags"]]);
    });

    it("says nothing when both sides made the same change", () => {
        const conflicts: string[][] = [];
        const { result, rerender } = setup({ title: "Draft", status: "review" }, (paths) => conflicts.push(paths));

        act(() => {
            result.current.setFieldValue("status", "published");
        });
        rerender({ baseline: { title: "Draft", status: "published" } });

        expect(conflicts).toEqual([]);
        expect(result.current.dirty).toBe(false);
    });

    it("undo does not bring the old value of an untouched field back either", () => {
        const { result, rerender } = setup({ title: "Draft", status: "review" });

        act(() => {
            result.current.setFieldValue("title", "Draft v2");
        });
        act(() => {
            result.current.setFieldValue("title", "Draft v3");
        });
        rerender({ baseline: { title: "Draft", status: "published" } });

        act(() => {
            result.current.undo();
        });
        expect(result.current.values).toEqual({ title: "Draft v2", status: "published" });
    });
});
